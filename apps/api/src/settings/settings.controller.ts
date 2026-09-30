import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Post,
  Put,
} from '@nestjs/common';
import {
  AzureAuthStatusSchema,
  UpdateSettingsRequestSchema,
  type AzureAuthStatus,
} from '@pr-orchestrator/contracts';
import { z } from 'zod';
import { SettingsService } from './settings.service.js';
import { SecretValuesService } from '../secrets/secret-store.js';
import { parseBody } from '../platform/http/parse-body.js';
export const PLATFORM_AZURE_AUTH_HTTP = Symbol('PLATFORM_AZURE_AUTH_HTTP');
export interface AzureAuthHttpPort {
  status(): Promise<AzureAuthStatus>;
  test(): Promise<unknown>;
}
const PatSchema = z.strictObject({
  pat: z
    .string()
    .trim()
    .min(1)
    .max(2560)
    .regex(/^[!-~]+$/),
});
@Controller('api/settings')
export class SettingsController {
  constructor(
    @Inject(SettingsService) private readonly settings: SettingsService,
    @Inject(SecretValuesService) private readonly secrets: SecretValuesService,
    @Inject(PLATFORM_AZURE_AUTH_HTTP) private readonly azure: AzureAuthHttpPort,
  ) {}
  @Get() get() {
    return this.settings.get();
  }
  @Put() async update(@Body() body: unknown) {
    const patch = parseBody(UpdateSettingsRequestSchema, body);
    try {
      return await this.settings.update(patch);
    } catch {
      throw new BadRequestException('Invalid settings');
    }
  }
  @Get('azure-auth') async status() {
    return AzureAuthStatusSchema.parse(await this.azure.status());
  }
  @Put('azure-pat') async savePat(@Body() body: unknown) {
    const { pat } = parseBody(PatSchema, body);
    await this.secrets.setPat(pat);
    return this.status();
  }
  @Delete('azure-pat') async deletePat() {
    await this.secrets.deletePat();
    return this.status();
  }
  @Post('azure-auth/test') @HttpCode(200) async test() {
    return this.azure.test();
  }
}
