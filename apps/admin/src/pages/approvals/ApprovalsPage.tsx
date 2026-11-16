import { useToast, t } from '@tangent/web-ui';
import { Page } from '../../app/Page';
import { usePageTabs } from '../../app/tabs';
import { useApprovalList, type ApprovalView } from './ApprovalList';

/** Everything that needs a second person: what waits for me, what I sent, and what was decided (with the reason). */
export function ApprovalsPage() {
  const { toast, say } = useToast();
  const { tab, tabs } = usePageTabs('/approvals');
  const { list, overlay } = useApprovalList((tab || 'waiting') as ApprovalView, undefined, say);
  return (
    <Page title={t('admin.approvals_page.approvals')} sub={t('admin.approvals_page.requests_that_need_a_yes')} toast={toast} tabs={tabs} overlays={overlay}>
      {list}
    </Page>
  );
}
