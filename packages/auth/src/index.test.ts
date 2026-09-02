import { describe, it, expect, vi, beforeEach } from "vitest";
import { isAdmin, isStaff, resolveProfile, commonAuthOptions } from "./index";

describe("resolveProfile", () => {
	const mockSupabase = {
		from: vi.fn().mockReturnThis(),
		select: vi.fn().mockReturnThis(),
		eq: vi.fn().mockReturnThis(),
		maybeSingle: vi.fn(),
	} as any;

	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("should resolve profile by direct ID match", async () => {
		const mockProfile = { id: "user-123", role: "admin" };
		mockSupabase.maybeSingle.mockResolvedValueOnce({ data: mockProfile });

		const result = await resolveProfile(mockSupabase, { id: "user-123" });

		expect(result).toEqual(mockProfile);
		expect(mockSupabase.from).toHaveBeenCalledWith("profiles");
		expect(mockSupabase.eq).toHaveBeenCalledWith("id", "user-123");
	});

	it("should fallback to Discord bridge if direct ID fails", async () => {
		const mockAccount = { account_id: "discord-456" };
		const mockProfile = { id: "profile-789", discord_id: "discord-456", role: "user" };

		// 1. Direct ID fails
		mockSupabase.maybeSingle.mockResolvedValueOnce({ data: null });
		// 2. Account fetch succeeds
		mockSupabase.maybeSingle.mockResolvedValueOnce({ data: mockAccount });
		// 3. Profile fetch by discord_id succeeds
		mockSupabase.maybeSingle.mockResolvedValueOnce({ data: mockProfile });

		const result = await resolveProfile(mockSupabase, { id: "user-123" });

		expect(result).toEqual(mockProfile);
		expect(mockSupabase.eq).toHaveBeenCalledWith("provider_id", "discord");
		expect(mockSupabase.eq).toHaveBeenCalledWith("discord_id", "discord-456");
	});

	it("should fallback to email if Discord bridge fails", async () => {
		const mockProfile = { id: "profile-email", email: "test@example.com", role: "editor" };

		// 1. Direct ID fails
		mockSupabase.maybeSingle.mockResolvedValueOnce({ data: null });
		// 2. Account fetch fails
		mockSupabase.maybeSingle.mockResolvedValueOnce({ data: null });
		// 3. Email fetch succeeds
		mockSupabase.maybeSingle.mockResolvedValueOnce({ data: mockProfile });

		const result = await resolveProfile(mockSupabase, {
			id: "user-123",
			email: "test@example.com",
		});

		expect(result).toEqual(mockProfile);
		expect(mockSupabase.eq).toHaveBeenCalledWith("email", "test@example.com");
	});
});

describe("Role Helpers", () => {
	describe("isAdmin", () => {
		it("should return true for admin role", () => {
			expect(isAdmin("admin")).toBe(true);
		});

		it("should return true for superadmin role", () => {
			expect(isAdmin("superadmin")).toBe(true);
		});

		it("should return true for editor role", () => {
			expect(isAdmin("editor")).toBe(true);
		});

		it("should return false for user role", () => {
			expect(isAdmin("user")).toBe(false);
		});

		it("should return false for null/undefined", () => {
			expect(isAdmin(null)).toBe(false);
			expect(isAdmin(undefined)).toBe(false);
		});
	});

	describe("isStaff", () => {
		it("should return true for admin role", () => {
			expect(isStaff("admin")).toBe(true);
		});

		it("should return true for staff role", () => {
			expect(isStaff("staff")).toBe(true);
		});

		it("should return false for user role", () => {
			expect(isStaff("user")).toBe(false);
		});
	});
});

describe("commonAuthOptions", () => {
	it("should have correct two-factor field mappings", () => {
		expect(commonAuthOptions.user.fields.twoFactorEnabled).toBe("two_factor_enabled");
		expect(commonAuthOptions.user.fields.twoFactorSecret).toBe("two_factor_secret");
		expect(commonAuthOptions.user.fields.twoFactorBackupCodes).toBe("two_factor_backup_codes");
	});
});
