/**
 * SpaceUI's public primitive surface, retained as the compatibility contract.
 * NIE-specific additions are deliberately small and use the same semantic
 * classes as the upstream components.
 */
export * from "@spacedrive/primitives";

export {
	CheckBox as Checkbox,
	Divider as Separator,
	ProgressBar as Progress,
	TextArea as Textarea,
	ToggleGroup as LegacyToggleGroup,
} from "@spacedrive/primitives";

export {
	Skeleton,
	TabsContent,
	TabsList,
	TabsRoot,
	TabsTrigger,
	Toggle,
	ToggleGroup,
	ToggleGroupItem,
	ToggleGroupRoot,
} from "./primitives";
export type {
	SkeletonProps,
	TabsContentProps,
	ToggleProps,
	ToggleGroupItemProps,
} from "./primitives";
