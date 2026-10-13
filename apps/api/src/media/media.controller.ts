import { Controller, Get, Header, Param, Query, StreamableFile } from '@nestjs/common';
import { Public } from '../common/auth.guard.js';
import { ApiError } from '../common/http.js';
import { GenerationsService } from '../generations/generations.service.js';

@Controller()
export class MediaController {
  constructor(private readonly generations: GenerationsService) {}

  @Public()
  @Get('media/:kind/:id')
  @Header('X-Content-Type-Options', 'nosniff')
  @Header('Cache-Control', 'private, max-age=60')
  async open(
    @Param('kind') kind: string,
    @Param('id') id: string,
    @Query('exp') exp?: string,
    @Query('sig') sig?: string,
  ): Promise<StreamableFile> {
    const file = await this.generations.readSigned(kind, id, exp, sig);
    if (!file) throw new ApiError(404, 'NOT_FOUND', 'Not found.');
    return new StreamableFile(file.bytes, { type: file.mimeType, disposition: 'inline' });
  }
}
