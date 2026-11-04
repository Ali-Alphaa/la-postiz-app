'use client';

import { FC, useCallback, useEffect, useState } from 'react';
import { useFetch } from '@gitroom/helpers/utils/custom.fetch';
import { Button } from '@gitroom/react/form/button';
import { useToaster } from '@gitroom/react/toaster/toaster';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import {
  GrowthCard,
  GrowthSection,
} from '@gitroom/frontend/components/growth/channel.select';
import {
  BioLink,
  useBioPage,
} from '@gitroom/frontend/components/growth/growth.tools.hooks';

const inputClass =
  'w-full bg-newBgColorInner border border-newTableBorder rounded-[8px] px-[12px] py-[8px] outline-none text-textColor';

export const BioEditor: FC = () => {
  const t = useT();
  const fetch = useFetch();
  const toaster = useToaster();
  const { data, mutate } = useBioPage();
  const [slug, setSlug] = useState('');
  const [title, setTitle] = useState('');
  const [bio, setBio] = useState('');
  const [avatar, setAvatar] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [links, setLinks] = useState<BioLink[]>([]);

  useEffect(() => {
    if (data?.slug) {
      setSlug(data.slug);
      setTitle(data.title || '');
      setBio(data.bio || '');
      setAvatar(data.avatar || '');
      setEnabled(data.enabled ?? true);
      setLinks(data.links || []);
    }
  }, [data]);

  const change = useCallback(
    (index: number, key: 'title' | 'url', value: string) =>
      setLinks((prev) =>
        prev.map((p, i) => (i === index ? { ...p, [key]: value } : p))
      ),
    []
  );

  const save = useCallback(async () => {
    const response = await fetch('/growth-tools/bio', {
      method: 'PUT',
      body: JSON.stringify({
        slug,
        title,
        enabled,
        links,
        bio: bio || null,
        avatar: avatar || null,
      }),
    });
    if (!response.ok) {
      const { message } = await response.json().catch(() => ({}));
      toaster.show(
        response.status === 409
          ? t('bio_taken', 'This address is already taken')
          : Array.isArray(message)
          ? message[0]
          : t(
              'bio_invalid',
              'Check the address (lowercase letters, numbers and dashes) and that links start with https://'
            ),
        'warning'
      );
      return;
    }
    toaster.show(t('bio_saved', 'Saved'), 'success');
    mutate();
  }, [slug, title, bio, avatar, enabled, links, t, mutate]);

  const address =
    typeof window !== 'undefined' && slug
      ? `${window.location.origin}/bio/${slug}`
      : '';

  return (
    <GrowthSection
      title={t('link_in_bio', 'Link in bio')}
      description={t(
        'link_in_bio_description',
        'One page for your profile links. Clicks are counted, and links are tagged so your leads show where they came from.'
      )}
    >
      <GrowthCard className="flex flex-col gap-[10px] max-w-[640px]">
        <input
          className={inputClass}
          placeholder={t('bio_slug', 'Address, e.g. thesigmatrader')}
          value={slug}
          onChange={(e) => setSlug(e.target.value.toLowerCase())}
        />
        {!!address && !!data?.slug && (
          <a
            href={address}
            target="_blank"
            rel="noreferrer"
            className="text-[13px] underline break-all"
          >
            {address}
          </a>
        )}
        <input
          className={inputClass}
          placeholder={t('bio_title', 'Title')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <textarea
          className={inputClass}
          placeholder={t('bio_text', 'Short description')}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
        />
        <input
          className={inputClass}
          placeholder={t('bio_avatar', 'Picture URL (optional)')}
          value={avatar}
          onChange={(e) => setAvatar(e.target.value)}
        />
        <label className="flex items-center gap-[6px] cursor-pointer">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => setEnabled(e.target.checked)}
          />
          {t('bio_enabled', 'Page is public')}
        </label>
        {links.map((link, index) => (
          <div key={link.key || index} className="flex gap-[8px] items-center">
            <input
              className={inputClass}
              placeholder={t('bio_link_title', 'Button text')}
              value={link.title}
              onChange={(e) => change(index, 'title', e.target.value)}
            />
            <input
              className={inputClass}
              placeholder="https://"
              value={link.url}
              onChange={(e) => change(index, 'url', e.target.value)}
            />
            <span className="text-[12px] text-textItemBlur whitespace-nowrap">
              {(link.key && data?.clicks?.[link.key]) || 0}{' '}
              {t('bio_clicks', 'clicks')}
            </span>
            <button
              type="button"
              className="text-[13px] text-red-400"
              onClick={() =>
                setLinks((prev) => prev.filter((_, i) => i !== index))
              }
            >
              {t('delete', 'Delete')}
            </button>
          </div>
        ))}
        <div className="flex gap-[8px]">
          <Button
            secondary={true}
            onClick={() =>
              setLinks((prev) => [...prev, { title: '', url: '' }])
            }
          >
            {t('bio_add_link', 'Add link')}
          </Button>
          <Button onClick={save} disabled={!slug || !title}>
            {t('save', 'Save')}
          </Button>
        </div>
      </GrowthCard>
    </GrowthSection>
  );
};
