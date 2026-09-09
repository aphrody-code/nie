//! IEVR team and roster value types.
//!
//! These are the data contracts consumed by the team builder. They deliberately
//! contain no persistence, HTTP, or UI behavior.

/// The seven displayed statistics of one team member.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct TeamMemberStats {
    /// Shooting power.
    pub kick: i64,
    /// Ball control.
    pub control: i64,
    /// Technique.
    pub technique: i64,
    /// Physical pressure.
    pub pressure: i64,
    /// Physical strength.
    pub physical: i64,
    /// Agility.
    pub agility: i64,
    /// Intelligence.
    pub intelligence: i64,
}

/// One character assigned to a team slot.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct TeamMember {
    /// Slot key (`field-0`, `reserve-2`, `manager-0`, or `support-0`).
    pub slot: String,
    /// Character identifier.
    pub chara_id: String,
    /// Display name.
    pub name: String,
    /// Game position (`FW`, `MF`, `DF`, or `GK`).
    pub position: String,
    /// Element name.
    pub element: String,
    /// Rarity label.
    pub rarity: String,
    /// Image URL.
    pub image_url: String,
    /// Public character slug.
    pub slug: String,
    /// Optional source statistics.
    pub stats: Option<TeamMemberStats>,
    /// Optional game-internal character code.
    pub internal_code: Option<String>,
    /// Optional Zukan hash.
    pub zukan_hash: Option<String>,
}

/// A serialized team composition.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct TeamData {
    /// Formation identifier.
    pub formation_id: String,
    /// Members in their persisted order.
    pub members: Vec<TeamMember>,
}

/// A saved team record.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct SavedTeam {
    /// Database identifier.
    pub id: String,
    /// User-facing team name.
    pub name: String,
    /// Persisted formation identifier.
    pub formation_id: String,
    /// Persisted composition.
    pub formation_data: TeamData,
    /// Whether the team is public.
    pub is_public: bool,
    /// Creation timestamp.
    pub created_at: String,
    /// Last update timestamp.
    pub updated_at: String,
}
