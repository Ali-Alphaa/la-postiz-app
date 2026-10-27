export const dynamic = 'force-dynamic';
import { Metadata } from 'next';
import { GrowthComponent } from '@gitroom/frontend/components/growth/growth.component';
import { isGeneralServerSide } from '@gitroom/helpers/utils/is.general.server.side';
export const metadata: Metadata = {
  title: `${isGeneralServerSide() ? 'Postiz' : 'Gitroom'} Growth`,
  description: '',
};
export default async function Index() {
  return <GrowthComponent />;
}
