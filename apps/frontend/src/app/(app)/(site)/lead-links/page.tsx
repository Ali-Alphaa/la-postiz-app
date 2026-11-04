export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { LeadLinksComponent } from '@gitroom/frontend/components/lead-links/lead.links.component';
import { isGeneralServerSide } from '@gitroom/helpers/utils/is.general.server.side';
export const metadata: Metadata = {
  title: `${isGeneralServerSide() ? 'Postiz' : 'Gitroom'} Lead Links`,
  description: '',
};
export default async function Index() {
  return <LeadLinksComponent />;
}
