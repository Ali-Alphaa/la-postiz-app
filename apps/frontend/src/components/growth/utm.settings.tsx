'use client';

import { FC, useCallback, useEffect, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { Button } from '@gitroom/react/form/button';
import { Input } from '@gitroom/react/form/input';
import { Slider } from '@gitroom/react/form/slider';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  errorMessage,
  useGrowthSettings,
} from '@gitroom/frontend/components/growth/growth.hooks';
import {
  GrowthCard,
  GrowthSection,
} from '@gitroom/frontend/components/growth/channel.select';

export const UtmSettings: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const { data, mutate } = useGrowthSettings();
  const [values, setValues] = useState({
    utmEnabled: false,
    utmSource: '{{provider}}',
    utmMedium: 'social',
    utmCampaign: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data) {
      setValues({
        utmEnabled: !!data.utmEnabled,
        utmSource: data.utmSource || '{{provider}}',
        utmMedium: data.utmMedium || 'social',
        utmCampaign: data.utmCampaign || '',
      });
    }
  }, [data]);

  const save = useCallback(async () => {
    setSaving(true);
    const response = await fetch('/growth/settings', {
      method: 'PUT',
      body: JSON.stringify(values),
    });
    setSaving(false);
    if (!response.ok) {
      toaster.show(
        await errorMessage(
          response,
          t('something_went_wrong', 'Something went wrong')
        ),
        'warning'
      );
      return;
    }
    mutate();
    toaster.show(t('settings_saved', 'Settings saved'), 'success');
  }, [values]);

  const example = `https://example.com/?utm_source=${encodeURIComponent(
    (values.utmSource || '{{provider}}').replace(/{{\s*provider\s*}}/gi, 'x')
  )}&utm_medium=${encodeURIComponent(values.utmMedium || 'social')}${
    values.utmCampaign
      ? `&utm_campaign=${encodeURIComponent(values.utmCampaign)}`
      : ''
  }`;

  return (
    <GrowthSection
      title={t('utm_tracking', 'UTM tracking links')}
      description={t(
        'utm_tracking_description',
        'Adds UTM parameters to the links of your posts when they are published (before they are shortened), so your website analytics show which channel brought the visit. Parameters already in a link are never replaced.'
      )}
    >
      <GrowthCard className="flex flex-col gap-[12px] max-w-[600px]">
        <div className="flex items-center gap-[12px]">
          <Slider
            value={values.utmEnabled ? 'on' : 'off'}
            onChange={(value) =>
              setValues((prev) => ({ ...prev, utmEnabled: value === 'on' }))
            }
            fill={true}
          />
          <div className="text-[14px]">
            {t('add_utm_parameters', 'Add UTM parameters to links')}
          </div>
        </div>
        <Input
          label="utm_source"
          name="utmSource"
          disableForm={true}
          value={values.utmSource}
          onChange={(e) =>
            setValues((prev) => ({ ...prev, utmSource: e.target.value }))
          }
        />
        <div className="text-[12px] text-newTextColor/60 -mt-[12px]">
          {t(
            'utm_source_hint',
            '{{provider}} is replaced with the platform (x, linkedin, bluesky...)',
            { provider: '{{provider}}', interpolation: { escapeValue: false } }
          )}
        </div>
        <Input
          label="utm_medium"
          name="utmMedium"
          disableForm={true}
          value={values.utmMedium}
          onChange={(e) =>
            setValues((prev) => ({ ...prev, utmMedium: e.target.value }))
          }
        />
        <Input
          label={`utm_campaign (${t('optional', 'optional')})`}
          name="utmCampaign"
          disableForm={true}
          value={values.utmCampaign}
          onChange={(e) =>
            setValues((prev) => ({ ...prev, utmCampaign: e.target.value }))
          }
        />
        <div className="text-[12px] text-newTextColor/60 break-all">
          {t('example', 'Example')}: {example}
        </div>
        <div>
          <Button onClick={save} loading={saving}>
            {t('save', 'Save')}
          </Button>
        </div>
      </GrowthCard>
    </GrowthSection>
  );
};
