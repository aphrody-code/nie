import * as SliderPrimitive from "@radix-ui/react-slider";
import type * as React from "react";

import { cn } from "../lib/utils";

function Slider({ className, ...props }: React.ComponentProps<typeof SliderPrimitive.Root>) {
	return (
		<SliderPrimitive.Root
			data-slot="slider"
			className={cn("relative flex w-full touch-none select-none items-center", className)}
			{...props}
		>
			<SliderPrimitive.Track
				data-slot="slider-track"
				className="relative h-2 w-full grow overflow-hidden rounded-full bg-secondary"
			>
				<SliderPrimitive.Range data-slot="slider-range" className="absolute h-full bg-primary" />
			</SliderPrimitive.Track>
			<SliderPrimitive.Thumb
				data-slot="slider-thumb"
				className="block size-5 rounded-full border-2 border-primary bg-background transition-colors focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] outline-hidden disabled:pointer-events-none disabled:opacity-50"
			/>
		</SliderPrimitive.Root>
	);
}

export { Slider };
