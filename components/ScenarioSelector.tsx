import React from 'react';

interface Scenario {
  scenario_id: number;
  scenario_name: string;
  protagonist: string;
  protagonist_initials: string;
  protagonist_role?: string;
  chat_topic?: string;
  chat_question: string;
  chat_time_limit: number;
  completed?: boolean;
  completed_count?: number;
}

interface ScenarioSelectorProps {
  scenarios: Scenario[];
  selectionMode: 'student_choice' | 'all_required';
  requireOrder: boolean;
  selectedScenarioId: number | null;
  onSelect: (scenarioId: number) => void;
  allCompleted?: boolean;
}

export const ScenarioSelector: React.FC<ScenarioSelectorProps> = ({
  scenarios,
  selectionMode,
  requireOrder,
  selectedScenarioId,
  onSelect,
  allCompleted = false
}) => {
  // For all_required + require_order, find the first incomplete scenario
  const getNextRequiredScenario = (): number | null => {
    if (selectionMode !== 'all_required' || !requireOrder) return null;
    const incomplete = scenarios.find(s => !s.completed);
    return incomplete?.scenario_id ?? null;
  };

  const nextRequiredId = getNextRequiredScenario();

  // Check if a scenario can be selected
  const canSelectScenario = (scenario: Scenario): boolean => {
    if (scenario.completed) return false;
    if (selectionMode === 'all_required' && requireOrder) {
      return scenario.scenario_id === nextRequiredId;
    }
    return true;
  };

  if (allCompleted) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
        <div className="text-green-600 font-medium mb-1">All scenarios completed!</div>
        <p className="text-sm text-green-700">
          You have completed all {scenarios.length} scenario(s) for this case.
        </p>
      </div>
    );
  }

  const completedCount = scenarios.filter(s => s.completed).length;

  return (
    <div className="space-y-4">
      {/* Progress indicator for all_required mode */}
      {selectionMode === 'all_required' && (
        <div className="mb-4">
          <div className="flex justify-between text-sm text-gray-600 mb-1">
            <span>Progress: {completedCount} of {scenarios.length} completed</span>
            {requireOrder && <span className="text-blue-600">Sequential order required</span>}
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all"
              style={{ width: `${(completedCount / scenarios.length) * 100}%` }}
            />
          </div>
        </div>
      )}

      <div className="text-sm text-gray-600 mb-2">
        {selectionMode === 'student_choice'
          ? 'Select a scenario to chat with:'
          : 'Complete all required scenarios:'}
      </div>

      <div className="grid gap-3">
        {scenarios.map((scenario, index) => {
          const isSelected = selectedScenarioId === scenario.scenario_id;
          const isCompleted = scenario.completed;
          const isAvailable = canSelectScenario(scenario);
          const isLocked = selectionMode === 'all_required' && requireOrder && !isAvailable && !isCompleted;

          return (
            <button
              key={scenario.scenario_id}
              onClick={() => isAvailable && onSelect(scenario.scenario_id)}
              disabled={!isAvailable}
              className={`text-left p-4 rounded-lg border-2 transition-all ${
                isCompleted
                  ? 'bg-green-50 border-green-200 cursor-default'
                  : isSelected
                    ? 'bg-blue-50 border-blue-500'
                    : isAvailable
                      ? 'bg-white border-gray-200 hover:border-blue-300 hover:bg-blue-50 cursor-pointer'
                      : 'bg-gray-50 border-gray-200 cursor-not-allowed opacity-60'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    {requireOrder && (
                      <span className="text-xs text-gray-400 font-mono">#{index + 1}</span>
                    )}
                    <span className="font-medium text-gray-800">{scenario.scenario_name}</span>
                    {isCompleted && (
                      <span className="inline-flex items-center gap-1 text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        Completed
                      </span>
                    )}
                    {isLocked && (
                      <span className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                        <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                        </svg>
                        Complete previous first
                      </span>
                    )}
                    {scenario.chat_time_limit > 0 && (
                      <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">
                        {scenario.chat_time_limit}min
                      </span>
                    )}
                  </div>
                  <div className="text-sm text-gray-600">
                    <span className="font-medium">{scenario.protagonist}</span>
                    {scenario.protagonist_role && (
                      <span className="text-gray-400"> - {scenario.protagonist_role}</span>
                    )}
                  </div>
                  {scenario.chat_topic && (
                    <div className="text-xs text-gray-500 mt-1">{scenario.chat_topic}</div>
                  )}
                </div>
                {isSelected && !isCompleted && (
                  <div className="ml-3 flex-shrink-0">
                    <svg className="w-6 h-6 text-blue-500" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export default ScenarioSelector;
