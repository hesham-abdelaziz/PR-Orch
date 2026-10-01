import { ModelSelection, VerifiedReport as ContractVerifiedReport } from '@pr-orchestrator/contracts';

export type CoverageStatus = 'checked' | 'not_applicable' | 'missing';
export type CoverageAreaSource = 'protocol' | 'standards';

export interface ReviewAreaCoverage {
  area: string;
  title: string;
  source: CoverageAreaSource;
  status: CoverageStatus;
  note?: string;
}

export interface ReviewerCoverage {
  reviewer: ModelSelection;
  areas: ReviewAreaCoverage[];
}

export type VerifiedReportWithCoverage = ContractVerifiedReport & {
  coverage?: ReviewerCoverage[];
};
