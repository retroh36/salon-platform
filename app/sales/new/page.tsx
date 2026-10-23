import { redirect } from "next/navigation";

// Old link: new sales open the full-screen checkout.
export default async function NewSalePage({ searchParams }: PageProps<"/sales/new">) {
  const { product } = await searchParams;
  redirect(`/checkout/new?from=/sales${typeof product === "string" ? `&product=${encodeURIComponent(product)}` : ""}`);
}
