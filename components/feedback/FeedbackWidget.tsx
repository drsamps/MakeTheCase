import React, { useState } from 'react';
import { useFeedbackEligibility } from '../../hooks/useFeedbackEligibility';
import FeedbackPanel from './FeedbackPanel';
import RightEdgeTab from './variants/RightEdgeTab';
import BottomRightFab from './variants/BottomRightFab';

interface FeedbackWidgetProps {
  userId?: string | null;
  // When the widget style is `header_link`, the chrome is rendered by the
  // header component (which uses <HeaderLink/> directly). The root mount
  // returns null in that case so we don't double-render a floating control.
  suppressHeaderLink?: boolean;
}

const FeedbackWidget: React.FC<FeedbackWidgetProps> = ({ userId, suppressHeaderLink = false }) => {
  const { eligibility, loading } = useFeedbackEligibility(userId);
  const [open, setOpen] = useState(false);

  if (!userId) return null;
  if (loading) return null;
  if (!eligibility || !eligibility.canSubmit) return null;
  if (eligibility.widgetStyle === 'hidden') return null;
  if (eligibility.widgetStyle === 'header_link' && suppressHeaderLink) return null;

  return (
    <>
      {eligibility.widgetStyle === 'right_edge_tab' && <RightEdgeTab onClick={() => setOpen(true)} />}
      {eligibility.widgetStyle === 'bottom_right_fab' && <BottomRightFab onClick={() => setOpen(true)} />}
      <FeedbackPanel open={open} onClose={() => setOpen(false)} />
    </>
  );
};

export default FeedbackWidget;
