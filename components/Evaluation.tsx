import React from 'react';
import { EvaluationResult } from '../types';

interface EvaluationProps {
  result: EvaluationResult | null;
  studentName: string;
  onRestart: () => void;
  superModelName: string | null;
  onLogout?: () => void;
  onTitleContextNav?: () => void;
}

const LoadingSpinner: React.FC<{ modelName: string | null }> = ({ modelName }) => (
    <div className="flex flex-col items-center justify-center text-center p-4">
        <div className="w-16 h-16 border-4 border-blue-500 border-dashed rounded-full animate-spin"></div>
        <p className="mt-4 text-xl font-semibold text-gray-700">The AI Supervisor is reviewing your conversation to provide feedback...</p>
        <p className="mt-2 text-gray-500">This may take a moment.</p>
        {modelName && <p className="mt-8 text-xs text-gray-400">Using supervisor model: {modelName}</p>}
    </div>
);

// FIX: Correctly type the component's props using React.FC<EvaluationProps> to resolve type errors.
const Evaluation: React.FC<EvaluationProps> = ({ result, studentName, onRestart, superModelName, onLogout, onTitleContextNav }) => {
  if (!result) {
    return (
        <div className="flex items-center justify-center min-h-screen bg-gray-200">
            <LoadingSpinner modelName={superModelName} />
        </div>
    );
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-200 p-4">
      <div className="w-full max-w-3xl p-8 space-y-6 bg-white rounded-2xl shadow-xl transform transition-all animate-fade-in">
        <div className="text-center border-b pb-4">
          <h1
            className="text-3xl font-bold text-gray-900 cursor-pointer"
            onContextMenu={(e) => {
              e.preventDefault();
              onTitleContextNav?.();
            }}
          >
            Performance Review
          </h1>
          <p className="mt-2 text-lg text-gray-600">Evaluation for {studentName}</p>
        </div>
        
        <div className="p-4 bg-blue-50 rounded-lg">
            <h2 className="text-xl font-semibold text-gray-800 mb-2">Supervisor's Summary</h2>
            <p className="text-gray-700">{result.summary}</p>
        </div>

        {typeof result.hints === 'number' && (
          <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <h3 className="text-lg font-semibold text-yellow-800">Hints Requested: {result.hints}</h3>
              <p className="text-sm text-yellow-700 mt-1">
                  You get one free hint. Each additional hint reduces your final score by one point. This adjustment is already reflected in your total score.
              </p>
          </div>
        )}

        <div className="space-y-6">
            {result.criteria.map((criterion, index) => (
                <div key={index} className="border border-gray-200 rounded-lg p-4">
                    <div className="flex justify-between items-start">
                        <p className="text-md font-semibold text-gray-800 flex-1 pr-4">{criterion.question}</p>
                        <div className="text-lg font-bold text-white bg-blue-600 rounded-full w-12 h-12 flex items-center justify-center flex-shrink-0">
                            {criterion.score}/5
                        </div>
                    </div>
                    <p className="text-sm text-gray-600 mt-2 pl-1"><strong className="font-medium">Feedback:</strong> {criterion.feedback}</p>
                </div>
            ))}
        </div>
        
        <div className="text-center pt-4 border-t">
             <div className="text-2xl font-bold text-gray-800 mb-4">
                Total Score: {result.totalScore} / 15
             </div>
            <button
              onClick={onLogout || onRestart}
              className="w-full max-w-xs px-6 py-3 font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-transform transform hover:scale-105"
            >
              Logout
            </button>
        </div>
      </div>
       <style>{`
        @keyframes fade-in {
            from { opacity: 0; transform: scale(0.95); }
            to { opacity: 1; transform: scale(1); }
        }
        .animate-fade-in {
            animation: fade-in 0.5s ease-out forwards;
        }
       `}</style>
    </div>
  );
};

export default Evaluation;