export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { InboxComponent } from '@gitroom/frontend/components/inbox/inbox.component';
import { isGeneralServerSide } from '@gitroom/helpers/utils/is.general.server.side';
export const metadata: Metadata = {
  title: `${isGeneralServerSide() ? 'Postiz' : 'Gitroom'} Inbox`,
  description: '',
};
export default async function Index() {
  return <InboxComponent />;
}
