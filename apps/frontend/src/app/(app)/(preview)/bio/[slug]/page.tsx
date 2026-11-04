import { internalFetch } from '@gitroom/helpers/utils/internal.fetch';
import { Metadata } from 'next';

export const dynamic = 'force-dynamic';

const loadPage = async (slug: string) => {
  const response = await internalFetch(
    `/public/bio/${encodeURIComponent(slug)}`
  );
  return response.ok ? response.json() : null;
};

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const page = await loadPage((await props.params).slug);
  return { title: page?.title || 'Not found', description: page?.bio || '' };
}

export default async function BioPublicPage(props: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await props.params;
  const page = await loadPage(slug);

  return (
    <div className="fixed inset-0 overflow-auto bg-[#0B0B0F] text-white">
      <div className="mx-auto flex max-w-[520px] flex-col items-center gap-[14px] px-[16px] py-[48px]">
        {!page ? (
          <div>Page not found</div>
        ) : (
          <>
            {!!page.avatar && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={page.avatar}
                alt=""
                className="h-[96px] w-[96px] rounded-full object-cover"
              />
            )}
            <h1 className="text-center text-[24px] font-[700]">{page.title}</h1>
            {!!page.bio && (
              <p className="whitespace-pre-wrap text-center text-[15px] opacity-80">
                {page.bio}
              </p>
            )}
            <div className="mt-[8px] flex w-full flex-col gap-[12px]">
              {page.links.map((link: { key: string; title: string }) => (
                <a
                  key={link.key}
                  href={`${
                    process.env.NEXT_PUBLIC_BACKEND_URL
                  }/public/bio/${encodeURIComponent(
                    slug
                  )}/go/${encodeURIComponent(link.key)}`}
                  rel="noreferrer"
                  className="w-full rounded-[12px] bg-white/10 px-[16px] py-[14px] text-center font-[600] hover:bg-white/20"
                >
                  {link.title}
                </a>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
