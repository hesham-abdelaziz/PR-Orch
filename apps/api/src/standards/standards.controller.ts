import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Put,
  Res,
} from '@nestjs/common';
import { z } from 'zod';
import type { Response } from 'express';
import { StandardsService } from './standards.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { parseBody } from '../platform/http/parse-body.js';
const UploadSchema = z.strictObject({
  filename: z.string().min(1).max(255),
  content: z.string().max(1_048_576),
});
@Controller('api/standards')
export class StandardsController {
  constructor(
    @Inject(StandardsService) private readonly standards: StandardsService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}
  @Get() async status(@Res() response: Response) {
    response.json(await this.standards.readActive());
  }
  @Get('content') async content() {
    return { content: await this.standards.readContent() };
  }
  @Put() async replace(@Body() body: unknown) {
    const data = parseBody(UploadSchema, body);
    if (
      Buffer.byteLength(data.content, 'utf8') >
      (await this.settings.get()).standardsMaxBytes
    )
      throw new BadRequestException('Standards exceed configured size limit');
    try {
      return await this.standards.replace(data.filename, data.content);
    } catch {
      throw new BadRequestException(
        'Standards must be a UTF-8 Markdown or text file of at most 1 MiB',
      );
    }
  }
}
