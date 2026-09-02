import type { Metadata } from "next";
import Image from "next/image";
import { apiClient } from "@/lib/api-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
	alternates: { canonical: "/soutenir" },
	description:
		"Soutenez la communauté Inazuma Eleven en France. Découvrez comment aider Rose Griffon.",
	title: "Nous soutenir - Azalée",
};

export default async function SoutenirPage() {
	const products = await apiClient.shop.getProducts();

	return (
		<div className="w-full">
			<div className="text-center mb-12">
				<h1 className="type-display-medium mb-4 text-primary">Nous Soutenir</h1>
				<p className="type-body-large text-on-surface-variant max-w-2xl mx-auto">
					Aidez-nous à faire vivre la communauté Inazuma Eleven en France.
				</p>
			</div>

			{/* Products Grid */}
			{products.length > 0 ? (
				<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
					{products.map((product: any) => (
						<div
							key={product.id}
							className="bg-surface-container rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow"
						>
							{product.image_url && (
								<div className="aspect-video bg-surface-container-high relative">
									<Image
										src={product.image_url}
										alt={product.name}
										fill
										sizes="(max-width: 768px) 100vw, (max-width: 1280px) 50vw, 33vw"
										className="object-cover"
									/>
								</div>
							)}
							<div className="p-6">
								<h3 className="type-title-medium font-bold text-on-surface mb-2">{product.name}</h3>
								<p className="type-body-medium text-on-surface-variant mb-4">
									{product.description}
								</p>
								<div className="flex items-center justify-between mt-auto">
									<span className="type-title-large text-primary">{product.price} €</span>
									<button className="px-4 py-2 bg-primary text-on-primary rounded-full type-label-large font-medium hover:brightness-110">
										Commander
									</button>
								</div>
							</div>
						</div>
					))}
				</div>
			) : (
				<div className="text-center py-12 bg-surface-container/50 rounded-2xl border border-dashed border-outline/30">
					<p className="text-on-surface-variant">Aucun produit disponible pour le moment.</p>
				</div>
			)}
		</div>
	);
}
