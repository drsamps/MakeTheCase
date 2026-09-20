import React from 'react';

interface ScoreChartProps {
  distribution: number[];
  maxScore?: number;
  height?: number;
}

// A rubric's total_points is the sum of its criteria, and each criterion allows up
// to 100 points, so the score range is effectively unbounded. Past a couple of dozen
// columns the bars and their labels collapse into an unreadable strip, so wide ranges
// are bucketed instead. Plain score labels ("0".."25") stay narrow, but range labels
// ("14-27") need more room, hence the two limits.
const MAX_UNBUCKETED_BARS = 26;
const MAX_BUCKETED_BARS = 20;

interface Bar {
  /** x-axis label: a score ("7") or an inclusive range ("14-27"). */
  label: string;
  count: number;
  title: string;
}

const buildBars = (distribution: number[], maxScore: number): Bar[] => {
  const scores = distribution.slice(0, maxScore + 1);

  if (scores.length <= MAX_UNBUCKETED_BARS) {
    return scores.map((count, score) => ({
      label: String(score),
      count,
      title: `Score ${score}`
    }));
  }

  const bucketSize = Math.ceil(scores.length / MAX_BUCKETED_BARS);
  const bars: Bar[] = [];
  for (let start = 0; start < scores.length; start += bucketSize) {
    const end = Math.min(start + bucketSize - 1, scores.length - 1);
    bars.push({
      label: start === end ? String(start) : `${start}-${end}`,
      count: scores.slice(start, end + 1).reduce((sum, n) => sum + n, 0),
      title: start === end ? `Score ${start}` : `Scores ${start}-${end}`
    });
  }
  return bars;
};

const ScoreChart: React.FC<ScoreChartProps> = ({
  distribution,
  maxScore = 15,
  height = 80
}) => {
  const bars = buildBars(distribution, maxScore);
  const bucketed = bars.length < Math.min(distribution.length, maxScore + 1);
  const maxCount = Math.max(...bars.map(b => b.count), 1);

  return (
    <div className="flex items-end gap-1" style={{ height: `${height + 40}px` }}>
      {bars.map((bar, index) => {
        const barHeight = bar.count > 0 ? Math.max((bar.count / maxCount) * height, 4) : 0;
        return (
          <div key={index} className="flex flex-col items-center justify-end flex-1 h-full">
            {bar.count > 0 && (
              <span className="text-xs font-medium text-gray-600 mb-1">{bar.count}</span>
            )}
            <div
              className="w-full bg-blue-500 rounded-t transition-all"
              style={{ height: `${barHeight}px` }}
              title={`${bar.title}: ${bar.count} student${bar.count !== 1 ? 's' : ''}`}
            />
            <span
              className={`${bucketed ? 'text-[10px]' : 'text-xs'} text-gray-500 mt-1 whitespace-nowrap`}
            >
              {bar.label}
            </span>
          </div>
        );
      })}
    </div>
  );
};

export default ScoreChart;
