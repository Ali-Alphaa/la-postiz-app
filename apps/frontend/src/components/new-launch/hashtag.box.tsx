'use client';

import { FC, useCallback } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useModals } from '@gitroom/frontend/components/layout/new-modal';
import { useT } from '@gitroom/react/translation/get.transation.service.client';
import { useLaunchStore } from '@gitroom/frontend/components/new-launch/store';
import { HashtagSuggestions } from '@gitroom/frontend/components/growth/hashtags';

// Editor button: suggests hashtags (history + AI) for the current channel
// and inserts the selected ones at the end of the post
export const HashtagBox: FC<{
  editor: any;
  text: string;
}> = ({ editor, text }) => {
  const t = useT();
  const modals = useModals();
  const { current, selectedIntegrations } = useLaunchStore(
    useShallow((state) => ({
      current: state.current,
      selectedIntegrations: state.selectedIntegrations,
    }))
  );

  const integrationId =
    current !== 'global'
      ? current
      : selectedIntegrations.length === 1
      ? selectedIntegrations[0].integration.id
      : undefined;

  const open = useCallback(() => {
    modals.openModal({
      title: t('hashtags', 'Hashtags'),
      withCloseButton: true,
      children: (close) => (
        <div className="w-full max-w-[500px] mx-auto">
          <HashtagSuggestions
            integrationId={integrationId}
            content={text}
            onInsert={(tags) => {
              editor?.commands?.insertContent(
                ' ' + tags.map((tag) => `#${tag}`).join(' ')
              );
              editor?.commands?.focus();
              close();
            }}
          />
        </div>
      ),
    });
  }, [editor, text, integrationId]);

  return (
    <div
      onClick={open}
      data-tooltip-id="tooltip"
      data-tooltip-content={t('hashtags', 'Hashtags')}
      className="select-none cursor-pointer rounded-[6px] mobile:rounded-[8px] w-[30px] h-[30px] mobile:w-[40px] mobile:h-[40px] bg-newColColor mobile:bg-newSettings flex justify-center items-center text-[15px] font-semibold"
    >
      #
    </div>
  );
};
