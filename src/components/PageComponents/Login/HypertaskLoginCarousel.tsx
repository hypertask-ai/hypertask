"use client";
import { useState, useEffect } from "react";
import { cn } from "@/utils/undoActions/helperFuncs";
import Image from "next/image";

interface CarouselSlide {
	id: number;
	imageUrl: string;
	alt: string;
}

const carouselData: CarouselSlide[] = [
	{
		id: 1,
		imageUrl: "https://files.hypertask.app/tasks/attachments/1755615360865c6bvkkq1moycuwhytcys.avif",
		alt: "Hypertask Inbox Preview 1"
	},
	{
		id: 2,
		imageUrl: "https://files.hypertask.app/tasks/attachments/1755614127383Screenshot%20from%202025-08-19%2019-34-38.avif",
		alt: "Hypertask Inbox Preview 2"
	},
	{
		id: 3,
		imageUrl: "https://files.hypertask.app/tasks/attachments/1755615151608Screenshot%20from%202025-08-19%2019-49-39.avif",
		alt: "Hypertask Inbox Preview 3"
	},
	{
		id: 4,
		imageUrl: "https://files.hypertask.app/tasks/attachments/1755615151615Screenshot%20from%202025-08-19%2019-51-35.avif",
		alt: "Hypertask Inbox Preview 4"
	},
    {
		id: 5,
		imageUrl: "https://files.hypertask.app/tasks/attachments/1755615151592Screenshot%20from%202025-08-19%2019-49-16.avif",
		alt: "Hypertask Inbox Preview 5"
	},
];

export const HypertaskLoginCarousel = () => {
	const [currentSlide, setCurrentSlide] = useState(0);

	useEffect(() => {
		const timer = setInterval(() => {
			setCurrentSlide((prev) => (prev + 1) % carouselData.length);
		}, 5000); // Auto-advance every 5 seconds

		return () => clearInterval(timer);
	}, []);

	const goToSlide = (index: number) => {
		setCurrentSlide(index);
	};

	return (
		<div 
			className="relative w-full h-full max-h-[92vh]"
			style={{
				marginRight: '0px !important',
				// Use Tailwind's max-w-[clamp()] utility for responsive clamping
				// Clamp between 420px and 84vh for max width
				maxWidth: 'clamp(420px, 90vh, 100vw)',
				maxHeight: '92vh !important'
			}}
		>
			{/* Carousel Container */}
			<div className="relative overflow-hidden rounded-tl-2xl h-full w-full">
				{/* Slides */}
				<div 
					className="flex h-full transition-transform duration-500 ease-in-out"
					style={{ transform: `translateX(-${currentSlide * 100}%)` }}
				>
					{carouselData.map((slide) => (
						<div key={slide.id} className="w-full h-full flex-shrink-0 relative">
							<Image
								width={1920}
								height={1920}
								src={slide.imageUrl}
								alt={slide.alt}
								className={cn(
									"w-full rounded-tl-2xl h-full object-cover min-h-[90svh] object-left",
									"[filter:_saturate(1.05)_brightness(1.03)_drop-shadow(0_0_2px_rgba(255,255,255,0.05))_drop-shadow(0_0_1.5px_rgba(0,0,0,0.10))_contrast(1.08)_blur(0.2px)]"
								)}								
							/>
							{/* Dark blur/shadow transition at bottom half */}
							<div className="absolute bottom-0 left-0 right-0 h-1/2 bg-gradient-to-t from-black/80 via-black/40 to-transparent pointer-events-none" />
						</div>
					))}
				</div>
			</div>

			{/* Bottom Navigation Bars */}
			<div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 flex justify-center items-center gap-2 z-30">
				{carouselData.map((_, index) => (
					<button
						key={index}
						onClick={() => goToSlide(index)}
						className={cn(
							"h-1.5 rounded-full transition-all duration-300",
							index === currentSlide 
								? "w-10 bg-white" 
								: "w-4 bg-gray-600 hover:bg-gray-500"
						)}
						aria-label={`Go to slide ${index + 1}`}
					/>
				))}
			</div>
		</div>
	);
};
