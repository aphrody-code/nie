import { describe, expect, it, vi } from "vitest";
import { InagleError, InagleErrorCode, inagleLogger, isInagleError, wrapError } from "./errors.js";

describe("InagleError", () => {
	it("should create error with code and message", () => {
		const error = new InagleError(InagleErrorCode.DATA_NOT_FOUND, "File not found");

		expect(error.name).toBe("InagleError");
		expect(error.code).toBe("DATA_NOT_FOUND");
		expect(error.message).toBe("File not found");
		expect(error.timestamp).toBeInstanceOf(Date);
	});

	it("should create error with details", () => {
		const error = new InagleError(InagleErrorCode.ENTITY_NOT_FOUND, "Character not found", {
			entityType: "character",
			entityId: "c01000100",
			hint: "Check the character ID format",
		});

		expect(error.details?.entityType).toBe("character");
		expect(error.details?.entityId).toBe("c01000100");
		expect(error.details?.hint).toBe("Check the character ID format");
	});

	it("should create error with cause", () => {
		const originalError = new Error("Original error");
		const error = new InagleError(
			InagleErrorCode.DATA_PARSE_ERROR,
			"Failed to parse",
			undefined,
			originalError
		);

		expect(error.cause).toBe(originalError);
	});

	it("should format error for logs", () => {
		const error = new InagleError(InagleErrorCode.DATA_NOT_FOUND, "Config file missing", {
			filePath: "/data/config.json",
			hint: "Run setup first",
		});

		const logString = error.toLogString();
		expect(logString).toContain("[Inagle] DATA_NOT_FOUND");
		expect(logString).toContain("Config file missing");
		expect(logString).toContain("File: /data/config.json");
		expect(logString).toContain("Hint: Run setup first");
	});

	it("should convert to JSON", () => {
		const error = new InagleError(InagleErrorCode.PARSER_ERROR, "Invalid format", {
			filePath: "test.json",
		});

		const json = error.toJSON();
		expect(json.name).toBe("InagleError");
		expect(json.code).toBe("PARSER_ERROR");
		expect(json.message).toBe("Invalid format");
		expect(json.details).toEqual({ filePath: "test.json" });
		expect(json.timestamp).toBeDefined();
	});
});

describe("isInagleError", () => {
	it("should return true for InagleError", () => {
		const error = new InagleError(InagleErrorCode.DATA_NOT_FOUND, "Test");
		expect(isInagleError(error)).toBe(true);
	});

	it("should return false for regular Error", () => {
		const error = new Error("Test");
		expect(isInagleError(error)).toBe(false);
	});

	it("should return false for non-Error values", () => {
		expect(isInagleError(null)).toBe(false);
		expect(isInagleError(undefined)).toBe(false);
		expect(isInagleError("error")).toBe(false);
		expect(isInagleError({ message: "error" })).toBe(false);
	});
});

describe("wrapError", () => {
	it("should return InagleError unchanged", () => {
		const original = new InagleError(InagleErrorCode.DATA_NOT_FOUND, "Test");
		const wrapped = wrapError(original, InagleErrorCode.PARSER_ERROR);

		expect(wrapped).toBe(original);
		expect(wrapped.code).toBe("DATA_NOT_FOUND");
	});

	it("should wrap regular Error", () => {
		const original = new Error("Original message");
		const wrapped = wrapError(original, InagleErrorCode.DATA_PARSE_ERROR);

		expect(wrapped).toBeInstanceOf(InagleError);
		expect(wrapped.code).toBe("DATA_PARSE_ERROR");
		expect(wrapped.message).toBe("Original message");
		expect(wrapped.cause).toBe(original);
	});

	it("should wrap string error", () => {
		const wrapped = wrapError("Something went wrong", InagleErrorCode.API_INIT_FAILED);

		expect(wrapped).toBeInstanceOf(InagleError);
		expect(wrapped.message).toBe("Something went wrong");
		expect(wrapped.cause).toBeUndefined();
	});

	it("should add context to message", () => {
		const original = new Error("File not found");
		const wrapped = wrapError(original, InagleErrorCode.DATA_NOT_FOUND, "Loading characters");

		expect(wrapped.message).toBe("Loading characters: File not found");
	});
});

describe("inagleLogger", () => {
	it("should log warnings with code and message", () => {
		const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

		inagleLogger.warn(InagleErrorCode.CONFIG_MISSING, "Missing config file");

		expect(warnSpy).toHaveBeenCalledWith("[Inagle] CONFIG_MISSING: Missing config file", "");

		warnSpy.mockRestore();
	});

	it("should log info messages", () => {
		const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

		inagleLogger.info("Service started");

		expect(infoSpy).toHaveBeenCalledWith("[Inagle] Service started");

		infoSpy.mockRestore();
	});

	it("should log errors with full details", () => {
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		const error = new InagleError(InagleErrorCode.DATA_NOT_FOUND, "File missing", {
			filePath: "/data/test.json",
		});

		inagleLogger.error(error);

		expect(errorSpy).toHaveBeenCalled();

		errorSpy.mockRestore();
	});
});

describe("InagleErrorCode", () => {
	it("should have all expected error codes", () => {
		expect(InagleErrorCode.DATA_NOT_FOUND).toBe("DATA_NOT_FOUND");
		expect(InagleErrorCode.DATA_PARSE_ERROR).toBe("DATA_PARSE_ERROR");
		expect(InagleErrorCode.DATA_VALIDATION_ERROR).toBe("DATA_VALIDATION_ERROR");
		expect(InagleErrorCode.CONFIG_MISSING).toBe("CONFIG_MISSING");
		expect(InagleErrorCode.CONFIG_INVALID).toBe("CONFIG_INVALID");
		expect(InagleErrorCode.PATH_NOT_FOUND).toBe("PATH_NOT_FOUND");
		expect(InagleErrorCode.API_INIT_FAILED).toBe("API_INIT_FAILED");
		expect(InagleErrorCode.ENTITY_NOT_FOUND).toBe("ENTITY_NOT_FOUND");
		expect(InagleErrorCode.INVALID_PARAMETER).toBe("INVALID_PARAMETER");
		expect(InagleErrorCode.PARSER_ERROR).toBe("PARSER_ERROR");
		expect(InagleErrorCode.BINARY_FORMAT_ERROR).toBe("BINARY_FORMAT_ERROR");
		expect(InagleErrorCode.JSON_FORMAT_ERROR).toBe("JSON_FORMAT_ERROR");
		expect(InagleErrorCode.NETWORK_ERROR).toBe("NETWORK_ERROR");
		expect(InagleErrorCode.SCRAPING_ERROR).toBe("SCRAPING_ERROR");
	});
});
