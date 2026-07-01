/** Skeleton for the creator profile — banner + header + post rows, so the page
 *  never flashes blank/unstyled before data arrives. */
export default function Loading() {
  return (
    <div className="mx-auto max-w-max-width pb-16">
      <div className="h-40 w-full animate-pulse bg-surface-container-high md:h-52" />
      <div className="mx-auto max-w-3xl px-margin-mobile md:px-margin-desktop">
        <div className="-mt-12 flex items-end justify-between">
          <div className="h-24 w-24 animate-pulse rounded-full border-4 border-background bg-surface-container-high" />
          <div className="mb-2 h-9 w-24 animate-pulse rounded-full bg-surface-container-high" />
        </div>
        <div className="mt-4 flex flex-col gap-2">
          <div className="h-7 w-48 animate-pulse rounded bg-surface-container-high" />
          <div className="h-4 w-32 animate-pulse rounded bg-surface-container-high" />
          <div className="mt-2 h-4 w-2/3 animate-pulse rounded bg-surface-container-high" />
          <div className="mt-3 flex gap-6">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="h-5 w-20 animate-pulse rounded bg-surface-container-high" />
            ))}
          </div>
        </div>
        <div className="mt-8 flex flex-col gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-surface-container-high" />
          ))}
        </div>
      </div>
    </div>
  );
}
