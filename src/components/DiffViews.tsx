import React, { useState } from 'react';
import { Copy, Check, Play, ShieldAlert, ArrowRight, FileCode2 } from 'lucide-react';
import type { ComputedDiff, DiffLine } from '../types/schema.ts';

interface SqlPlanViewProps {
  diff: ComputedDiff;
  onCreateMigration: (name: string, upSql: string, downSql: string) => void;
}

export const SqlPlanView: React.FC<SqlPlanViewProps> = ({ diff, onCreateMigration }) => {
  const [migName, setMigName] = useState('add_price_and_price_avgs_view');
  const [copiedStep, setCopiedStep] = useState<number | null>(null);

  const copySql = (step: number, sql: string) => {
    navigator.clipboard?.writeText(sql);
    setCopiedStep(step);
    setTimeout(() => setCopiedStep(null), 1500);
  };

  if (diff.sqlPlan.length === 0) {
    return (
      <div className="flex-1 bg-[#FCFCFD] p-6 sm:p-10 flex items-center justify-center">
        <div className="max-w-md w-full bg-white border border-[#E5E7EB] rounded-lg p-6 text-center">
          <FileCode2 className="w-8 h-8 text-[#9CA3AF] mx-auto mb-2.5" strokeWidth={1.6} />
          <h3 className="text-[14px] font-semibold text-[#111827]">No pending schema changes</h3>
          <p className="text-[12.5px] text-[#6B7280] mt-1">
            The baseline and target snapshots match. Edit the ERD or switch comparison versions in the sidebar to generate a SQL Plan.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 bg-[#FCFCFD] overflow-y-auto p-4 sm:p-6">
      <div className="max-w-4xl mx-auto space-y-5">
        <div className="bg-white border border-[#E5E7EB] rounded-lg p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-[15px] font-semibold text-[#111827]">Migration Execution Plan</h2>
            <p className="text-[12.5px] text-[#6B7280] mt-0.5 tabular-nums">
              {diff.sqlPlan.length} ordered PostgreSQL DDL step(s) · +{diff.summary.addedColumns} column(s) · +{diff.summary.addedViews} view(s) · +{diff.summary.addedTables} table(s)
            </p>
          </div>

          <div className="flex items-center gap-2">
            <input
              type="text"
              value={migName}
              onChange={(e) => setMigName(e.target.value)}
              placeholder="migration_name"
              className="h-8 px-2.5 text-[12px] font-mono border border-[#E5E7EB] rounded-md bg-white text-[#111827] w-48 sm:w-56"
            />
            <button
              type="button"
              onClick={() => onCreateMigration(migName || 'schema_migration', diff.upSql, diff.downSql)}
              className="h-8 px-3 bg-[#111827] hover:bg-[#1F2937] text-white text-[12.5px] font-medium rounded-md flex items-center gap-1.5 whitespace-nowrap shrink-0 cursor-pointer"
            >
              <Play className="w-3.5 h-3.5" />
              Save as Migration
            </button>
          </div>
        </div>

        <div className="space-y-3">
          {diff.sqlPlan.map((step) => {
            const isDestructive =
              step.action === 'DROP COLUMN' ||
              step.action === 'DROP TABLE' ||
              step.action === 'DROP VIEW';
            return (
              <div
                key={step.step}
                className="bg-white border border-[#E5E7EB] rounded-lg overflow-hidden"
              >
                <div className="px-4 py-2.5 border-b border-[#F3F4F6] flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <span className="text-[11px] font-mono font-semibold text-[#6B7280] tabular-nums">
                      STEP {String(step.step).padStart(2, '0')}
                    </span>
                    <ArrowRight className="w-3 h-3 text-[#9CA3AF]" />
                    <span
                      className={`text-[11.5px] font-semibold font-mono ${
                        isDestructive ? 'text-[#DC2626]' : 'text-[#16A34A]'
                      }`}
                    >
                      {step.action}
                    </span>
                    <span className="text-[12.5px] font-mono text-[#111827] truncate">
                      {step.target}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 text-[11.5px]">
                    <span className="text-[#6B7280] font-mono">Lock: {step.lockLevel}</span>
                    <span className="text-[#6B7280]">
                      {step.reversible ? 'Reversible' : 'Irreversible'}
                    </span>
                    <button
                      type="button"
                      onClick={() => copySql(step.step, step.statement)}
                      className="p-1 rounded hover:bg-[#F3F4F6] text-[#6B7280] hover:text-[#111827] cursor-pointer"
                      title="Copy SQL"
                    >
                      {copiedStep === step.step ? (
                        <Check className="w-3.5 h-3.5 text-[#16A34A]" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                </div>

                <div className="p-3.5 bg-[#FAFAFA]">
                  <pre className="font-mono text-[12px] text-[#111827] overflow-x-auto whitespace-pre-wrap leading-relaxed">
                    {step.statement}
                  </pre>
                  <p className="mt-2 text-[11.5px] text-[#6B7280] flex items-center gap-1.5">
                    {isDestructive && <ShieldAlert className="w-3.5 h-3.5 text-[#D97706]" />}
                    {step.notes}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

interface CodeDiffViewProps {
  mode: 'hcl' | 'sql';
  lines: DiffLine[];
  rawText: string;
  onCreateMigration?: () => void;
}

export const CodeDiffView: React.FC<CodeDiffViewProps> = ({
  mode,
  lines,
  rawText,
  onCreateMigration,
}) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const content =
      rawText ||
      lines
        .map((l) => `${l.type === 'added' ? '+ ' : l.type === 'removed' ? '- ' : '  '}${l.content}`)
        .join('\n');
    navigator.clipboard?.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="flex-1 bg-[#FCFCFD] overflow-y-auto p-4 sm:p-6">
      <div className="max-w-5xl mx-auto bg-white border border-[#E5E7EB] rounded-lg overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[#E5E7EB] flex items-center justify-between gap-2 bg-white">
          <div className="flex items-center gap-2 text-[12.5px]">
            <span className="font-semibold text-[#111827]">
              {mode === 'hcl' ? 'schema.hcl' : 'migration_diff.sql'}
            </span>
            <span className="text-[#9CA3AF]">·</span>
            <span className="text-[#6B7280] font-mono text-[11.5px] tabular-nums">
              {lines.filter((l) => l.type === 'added').length} additions,{' '}
              {lines.filter((l) => l.type === 'removed').length} deletions
            </span>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCopy}
              className="h-7 px-2.5 rounded border border-[#E5E7EB] hover:bg-[#F9FAFB] text-[12px] font-medium text-[#374151] flex items-center gap-1.5 cursor-pointer"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5 text-[#16A34A]" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              <span>{copied ? 'Copied' : 'Copy'}</span>
            </button>
            {onCreateMigration && lines.length > 0 && (
              <button
                type="button"
                onClick={onCreateMigration}
                className="h-7 px-2.5 rounded bg-[#111827] hover:bg-[#1F2937] text-[12px] font-medium text-white flex items-center gap-1.5 cursor-pointer"
              >
                <Play className="w-3 h-3" />
                <span>Create Migration</span>
              </button>
            )}
          </div>
        </div>

        {lines.length === 0 ? (
          <div className="p-8 text-center text-[13px] text-[#6B7280]">
            No {mode.toUpperCase()} differences between selected snapshots.
          </div>
        ) : (
          <div className="font-mono text-[12px] leading-[1.65] overflow-x-auto py-2">
            {lines.map((line) => (
              <div
                key={`${line.lineNumber}-${line.content}`}
                className={`flex items-start px-3 ${
                  line.type === 'added'
                    ? 'bg-[#ECFDF5] text-[#14532D]'
                    : line.type === 'removed'
                      ? 'bg-[#FEF2F2] text-[#7F1D1D]'
                      : 'text-[#374151]'
                }`}
              >
                <span className="w-10 shrink-0 text-right pr-3 select-none text-[#9CA3AF] tabular-nums">
                  {line.lineNumber}
                </span>
                <span
                  className={`w-5 shrink-0 select-none font-semibold ${
                    line.type === 'added'
                      ? 'text-[#16A34A]'
                      : line.type === 'removed'
                        ? 'text-[#DC2626]'
                        : 'text-transparent'
                  }`}
                >
                  {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                </span>
                <pre className="whitespace-pre flex-1">{line.content}</pre>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
