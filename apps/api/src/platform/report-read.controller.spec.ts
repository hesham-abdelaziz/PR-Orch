import { ReportReadController } from './report-read.controller.js';
import { NotFoundException } from '@nestjs/common';
import { ReportQueryService } from '../reports/report-query.service.js';

describe('additive structured report adapter', () => {
  it('delegates to the engine read service and rejects malformed or unavailable reports', async () => {
    const getReport = vi.fn().mockResolvedValue({ summary: 'stored report' });
    const controller = new ReportReadController({
      getReport,
    } as unknown as ReportQueryService);
    const id = '12345678-1234-1234-1234-123456789012';
    expect(await controller.get(id)).toEqual({ summary: 'stored report' });
    expect(getReport).toHaveBeenCalledWith(id);
    await expect(controller.get('../invalid')).rejects.toBeInstanceOf(
      NotFoundException,
    );
    getReport.mockResolvedValue(null);
    await expect(controller.get(id)).rejects.toBeInstanceOf(NotFoundException);
  });
});
