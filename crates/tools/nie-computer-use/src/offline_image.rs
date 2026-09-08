//! Bounded inspection of a linear, offline module image.
//!
//! The byte slice represents a loaded memory image: byte zero is RVA zero and
//! virtual addresses are `image_base + RVA`. This deliberately does not claim
//! that PE file offsets and RVAs are interchangeable after section mapping.

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// Largest offline image accepted by the portable inspector (64 MiB).
pub const MAX_OFFLINE_IMAGE_BYTES: usize = 64 * 1024 * 1024;
/// Largest number of ranges accepted in one request.
pub const MAX_INSPECTION_RANGES: usize = 128;
/// Largest sum of bytes returned by one request (1 MiB before hex encoding).
pub const MAX_INSPECTION_OUTPUT_BYTES: usize = 1024 * 1024;

/// Address namespace used by an offline inspection range.
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ImageAddressSpace {
    /// Offset in the supplied linear image. For a loaded image this is also its RVA.
    FileOffset,
    /// Relative virtual address from the supplied image base.
    Rva,
    /// Absolute virtual address in the supplied image.
    Va,
}

/// One bounded byte-range request. Addresses are strings to preserve all 64 bits in JavaScript.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImageRangeRequest {
    pub space: ImageAddressSpace,
    /// Decimal or `0x`-prefixed hexadecimal address.
    pub address: String,
    pub length: usize,
}

/// Portable inspection request. `image_base` is decimal or `0x`-prefixed hexadecimal.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImageInspectionRequest {
    pub image_base: String,
    pub ranges: Vec<ImageRangeRequest>,
}

/// Resolved byte range with precision-safe canonical addresses.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImageRangeResult {
    pub file_offset: String,
    pub rva: String,
    pub va: String,
    pub length: usize,
    pub sha256: String,
    pub hex: String,
}

/// Complete bounded inspection response.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ImageInspection {
    pub image_base: String,
    pub size_bytes: usize,
    pub sha256: String,
    pub ranges: Vec<ImageRangeResult>,
}

/// Borrowed view over one validated linear image.
#[derive(Clone, Copy, Debug)]
pub struct OfflineImage<'a> {
    bytes: &'a [u8],
    image_base: u64,
}

impl<'a> OfflineImage<'a> {
    /// Validate an image before any address arithmetic or allocation.
    pub fn new(bytes: &'a [u8], image_base: u64) -> Result<Self> {
        anyhow::ensure!(
            bytes.len() <= MAX_OFFLINE_IMAGE_BYTES,
            "offline image size {} exceeds {}",
            bytes.len(),
            MAX_OFFLINE_IMAGE_BYTES
        );
        Ok(Self { bytes, image_base })
    }

    #[must_use]
    pub fn image_base(&self) -> u64 {
        self.image_base
    }

    #[must_use]
    pub fn len(&self) -> usize {
        self.bytes.len()
    }

    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.bytes.is_empty()
    }

    /// Resolve one address to a byte offset/RVA, rejecting underflow and out-of-image values.
    pub fn resolve(&self, space: ImageAddressSpace, address: u64) -> Result<u64> {
        let offset = match space {
            ImageAddressSpace::FileOffset | ImageAddressSpace::Rva => address,
            ImageAddressSpace::Va => address
                .checked_sub(self.image_base)
                .context("VA is below image base")?,
        };
        anyhow::ensure!(
            offset <= self.bytes.len() as u64,
            "address 0x{address:x} is outside the offline image"
        );
        Ok(offset)
    }

    /// Read one range after checked address conversion.
    pub fn read(&self, space: ImageAddressSpace, address: u64, length: usize) -> Result<&'a [u8]> {
        anyhow::ensure!(
            length <= MAX_INSPECTION_OUTPUT_BYTES,
            "range length {length} exceeds {MAX_INSPECTION_OUTPUT_BYTES}"
        );
        let offset = self.resolve(space, address)?;
        let end = offset
            .checked_add(length as u64)
            .context("offline image range overflow")?;
        anyhow::ensure!(
            end <= self.bytes.len() as u64,
            "range 0x{offset:x}..0x{end:x} is outside the offline image"
        );
        Ok(&self.bytes[offset as usize..end as usize])
    }

    /// Inspect multiple ranges with a shared output budget.
    pub fn inspect(&self, ranges: &[ImageRangeRequest]) -> Result<ImageInspection> {
        anyhow::ensure!(
            ranges.len() <= MAX_INSPECTION_RANGES,
            "range count {} exceeds {}",
            ranges.len(),
            MAX_INSPECTION_RANGES
        );
        let total = ranges.iter().try_fold(0usize, |total, range| {
            total
                .checked_add(range.length)
                .context("inspection output length overflow")
        })?;
        anyhow::ensure!(
            total <= MAX_INSPECTION_OUTPUT_BYTES,
            "inspection output {total} exceeds {MAX_INSPECTION_OUTPUT_BYTES}"
        );

        let mut results = Vec::with_capacity(ranges.len());
        for range in ranges {
            let address = parse_address(&range.address)?;
            let offset = self.resolve(range.space, address)?;
            let bytes = self.read(range.space, address, range.length)?;
            let va = self
                .image_base
                .checked_add(offset)
                .context("RVA to VA overflow")?;
            results.push(ImageRangeResult {
                file_offset: hex_address(offset),
                rva: hex_address(offset),
                va: hex_address(va),
                length: bytes.len(),
                sha256: hex::encode(Sha256::digest(bytes)),
                hex: hex::encode(bytes),
            });
        }

        Ok(ImageInspection {
            image_base: hex_address(self.image_base),
            size_bytes: self.bytes.len(),
            sha256: hex::encode(Sha256::digest(self.bytes)),
            ranges: results,
        })
    }
}

/// Inspect a supplied linear image without filesystem, SQLite, process, or network access.
pub fn inspect_offline_image(
    bytes: &[u8],
    request: &ImageInspectionRequest,
) -> Result<ImageInspection> {
    let image_base = parse_address(&request.image_base).context("invalid imageBase")?;
    OfflineImage::new(bytes, image_base)?.inspect(&request.ranges)
}

/// JSON adapter intended for WebAssembly bindings. All addresses remain strings on the wire.
pub fn inspect_offline_image_json(bytes: &[u8], request_json: &str) -> Result<String> {
    anyhow::ensure!(
        request_json.len() <= 64 * 1024,
        "inspection request JSON exceeds 65536 bytes"
    );
    let request: ImageInspectionRequest =
        serde_json::from_str(request_json).context("parse offline image inspection request")?;
    serde_json::to_string(&inspect_offline_image(bytes, &request)?)
        .context("serialize offline image inspection response")
}

fn parse_address(value: &str) -> Result<u64> {
    let value = value.trim();
    anyhow::ensure!(!value.is_empty(), "address is empty");
    if let Some(hex) = value
        .strip_prefix("0x")
        .or_else(|| value.strip_prefix("0X"))
    {
        anyhow::ensure!(!hex.is_empty(), "hex address is empty");
        u64::from_str_radix(hex, 16).context("invalid hexadecimal address")
    } else {
        value.parse::<u64>().context("invalid decimal address")
    }
}

fn hex_address(value: u64) -> String {
    format!("0x{value:x}")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Vec<u8> {
        (0u8..=31).collect()
    }

    #[test]
    fn resolves_offset_rva_and_va_without_precision_loss() {
        let bytes = fixture();
        let image = OfflineImage::new(&bytes, 0x1_4000_0000).unwrap();
        assert_eq!(image.resolve(ImageAddressSpace::FileOffset, 3).unwrap(), 3);
        assert_eq!(image.resolve(ImageAddressSpace::Rva, 3).unwrap(), 3);
        assert_eq!(
            image.resolve(ImageAddressSpace::Va, 0x1_4000_0003).unwrap(),
            3
        );
    }

    #[test]
    fn json_contract_uses_hexadecimal_address_strings() {
        let response = inspect_offline_image_json(
            &fixture(),
            r#"{"imageBase":"0x140000000","ranges":[{"space":"va","address":"0x140000004","length":4}]}"#,
        )
        .unwrap();
        let value: serde_json::Value = serde_json::from_str(&response).unwrap();
        assert_eq!(value["imageBase"], "0x140000000");
        assert_eq!(value["ranges"][0]["fileOffset"], "0x4");
        assert_eq!(value["ranges"][0]["rva"], "0x4");
        assert_eq!(value["ranges"][0]["va"], "0x140000004");
        assert_eq!(value["ranges"][0]["hex"], "04050607");
        assert_eq!(value["ranges"][0]["length"], 4);
    }

    #[test]
    fn rejects_ranges_below_base_outside_image_and_over_budget() {
        let bytes = fixture();
        let image = OfflineImage::new(&bytes, 0x140000000).unwrap();
        assert!(
            image
                .read(ImageAddressSpace::Va, 0x0001_3fff_ffff, 1)
                .is_err()
        );
        assert!(image.read(ImageAddressSpace::Rva, 31, 2).is_err());
        assert!(
            image
                .read(
                    ImageAddressSpace::FileOffset,
                    0,
                    MAX_INSPECTION_OUTPUT_BYTES + 1
                )
                .is_err()
        );
    }

    #[test]
    fn rejects_oversized_batch_before_reading() {
        let bytes = fixture();
        let image = OfflineImage::new(&bytes, 0).unwrap();
        let ranges = vec![
            ImageRangeRequest {
                space: ImageAddressSpace::Rva,
                address: "0".into(),
                length: 0,
            };
            MAX_INSPECTION_RANGES + 1
        ];
        assert!(image.inspect(&ranges).is_err());
    }

    #[test]
    fn parses_decimal_and_uppercase_hex_addresses() {
        assert_eq!(parse_address("16").unwrap(), 16);
        assert_eq!(parse_address("0X10").unwrap(), 16);
        assert!(parse_address("0x").is_err());
        assert!(parse_address("-1").is_err());
    }
}
