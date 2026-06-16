import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-2xl space-y-stack-md px-margin-mobile py-32 text-center md:px-margin-desktop">
      <h1 className="font-display-lg text-display-lg-mobile md:text-display-lg">Page not found</h1>
      <p className="font-body-lg text-body-lg text-on-surface-variant">That line isn&apos;t for sale here.</p>
      <div className="flex justify-center pt-stack-md">
        <Link href="/" className="btn-primary px-10 py-4 !text-body-lg editorial-shadow">
          Back to LinePay Cite
        </Link>
      </div>
    </div>
  );
}
