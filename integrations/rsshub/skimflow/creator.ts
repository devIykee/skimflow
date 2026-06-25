import { Route } from '@/types';
import ofetch from '@/utils/ofetch';
import { parseDate } from '@/utils/parse-date';

const SKIMFLOW_BASE = 'https://skimflow.vercel.app';

interface SkimflowPost {
    id: string;
    title: string;
    url: string;
    publishDate: string;
    monetization: 'free' | 'paid';
    content: string | null;
    teaser: string | null;
}

interface SkimflowPostsResponse {
    creator: { id: string; name: string; profileUrl: string; bio: string | null };
    posts: SkimflowPost[];
}

export const route: Route = {
    path: '/creator/:creatorId',
    name: 'Creator posts',
    url: 'skimflow.vercel.app',
    maintainers: ['skimflow'],
    example: '/skimflow/creator/00000000-0000-0000-0000-000000000000',
    parameters: { creatorId: "The creator's Skimflow ID (UUID)" },
    description: 'Posts by a Skimflow creator. Paid posts include only the free teaser; full content lives on Skimflow.',
    categories: ['reading'],
    features: {
        requireConfig: false,
        requirePuppeteer: false,
        antiCrawler: false,
        supportBT: false,
        supportPodcast: false,
        supportScihub: false,
    },
    handler,
};

async function handler(ctx) {
    const { creatorId } = ctx.req.param();
    const limit = ctx.req.query('limit');

    const apiUrl = `${SKIMFLOW_BASE}/api/creators/${creatorId}/posts${limit ? `?limit=${encodeURIComponent(limit)}` : ''}`;
    // Use RSSHub's ofetch (not raw fetch) so caching/retries/UA are handled.
    const data = await ofetch<SkimflowPostsResponse>(apiUrl);

    const items = (data.posts ?? []).map((post) => ({
        title: post.title,
        link: post.url,
        // The API already gates paid content: free → full content, paid → teaser only.
        description: post.monetization === 'free' ? (post.content ?? '') : (post.teaser ?? ''),
        pubDate: parseDate(post.publishDate),
        author: data.creator.name,
        guid: post.id,
    }));

    return {
        title: `${data.creator.name} on Skimflow`,
        link: data.creator.profileUrl,
        description: data.creator.bio || `Posts by ${data.creator.name} on Skimflow`,
        item: items,
    };
}
