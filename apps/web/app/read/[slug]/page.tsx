import { notFound } from "next/navigation";
import { getChunks, getContentWithCreator, incrementView } from "@/lib/store";
import ChunkReader from "./_components/ChunkReader";

export const dynamic = "force-dynamic";

export default async function ReaderPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const content = await getContentWithCreator(slug);
  if (!content) notFound();

  if (content.status === "suspended") {
    return (
      <div className="mx-auto max-w-3xl px-margin-mobile py-32 text-center md:px-margin-desktop">
        <h1 className="mb-2 font-headline-sm text-headline-sm">Content suspended</h1>
        <p className="font-body-md text-on-surface-variant">
          {content.suspended_reason ?? "This content has been suspended by the platform."}
        </p>
      </div>
    );
  }
  if (content.status !== "published") notFound();

  void incrementView(content.id);
  const chunks = await getChunks(content.id);

  return (
    <ChunkReader
      slug={content.slug}
      title={content.title}
      summary={content.summary}
      creatorHandle={content.creator_handle}
      contentType={content.content_type}
      pricePerBlock={content.price_per_block}
      verifiedSource={content.ownership_verified ? (content.source_platform ?? "source") : null}
      agentUrl={content.content_type === "agent-skills" ? `/read/${content.slug}/agent-skills.md` : null}
      chunks={chunks.map((c) => ({
        id: c.id,
        blockIndex: c.block_index,
        isFree: c.is_free,
        text: c.is_free ? c.text : null,
      }))}
    />
  );
}
