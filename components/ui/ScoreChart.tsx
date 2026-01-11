import React from 'react';

interface ScoreChartProps {
  distribution: number[];
  maxScore?: number;
  height?: number;
}

const ScoreChart: React.FC<ScoreChartProps> = ({
  distribution,
  maxScore = 15,
  height = 80
}) => {
  const maxCount = Math.max(...distribution, 1);

  return (
    <div className="flex items-end gap-1" style={{ height: `${height + 40}px` }}>
      {distribution.slice(0, maxScore + 1).map((count, score) => {
        const barHeight = count > 0 ? Math.max((count / maxCount) * height, 4) : 0;
        return (
          <div key={score} className="flex flex-col items-center justify-end flex-1 h-full">
            {count > 0 && (
              <span className="text-xs font-medium text-gray-600 mb-1">{count}</span>
            )}
            <div
              className="w-full bg-blue-500 rounded-t transition-all"
              style={{ height: `${barHeight}px` }}
              title={`Score ${score}: ${count} student${count !== 1 ? 's' : ''}`}
            />
            <span className="text-xs text-gray-500 mt-1">{score}</span>
          </div>
        );
      })}
    </div>
  );
};

export default ScoreChart;
