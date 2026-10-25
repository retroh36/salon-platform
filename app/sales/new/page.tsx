import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";

// Old link: new sales open the full-screen checkout. (Its search params
// are read inside Suspense, so the production build can prerender it.)
export default function NewSalePage({ searchParams }: PageProps<"/sales/new">) {
  return (
    <Suspense>
      <ToCheckout searchParams={searchParams} />
    </Suspense>
  );
}

async function ToCheckout({ searchParams }: Pick<PageProps<"/sales/new">, "searchParams">): Promise<ReactNode> {
  const { product } = await searchParams;
  redirect(`/checkout/new?from=/sales${typeof product === "string" ? `&product=${encodeURIComponent(product)}` : ""}`);
}
