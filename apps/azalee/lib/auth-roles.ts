/**
 * Re-export depuis @rosegriffon/types — backward-compat pour les imports existants
 * `@/lib/auth-roles` (~30 fichiers azalee). Source canonique = @rosegriffon/types/roles.
 */
export {
	ADMIN_ROLES,
	USER_MANAGEMENT_ROLES,
	isAdminRole,
	isUserManagementRole,
	type AdminRole,
	type UserManagementRole,
} from "@rosegriffon/types/roles";
export { MEDAILLE_AZALEE_ROLE_ID } from "@rosegriffon/types/discord";
