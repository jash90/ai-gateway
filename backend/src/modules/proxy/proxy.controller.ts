import {
  Controller,
  Post,
  Body,
  Req,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common'
import { ApiTags, ApiOperation, ApiResponse, ApiSecurity } from '@nestjs/swagger'
import { ProxyService } from './proxy.service'
import { ApiKeyGuard } from '../../common/guards/api-key.guard'

@ApiTags('Proxy')
@Controller('v1/proxy')
export class ProxyController {
  constructor(private proxyService: ProxyService) {}

  @Post('anthropic/messages')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('api-key')
  @ApiOperation({ summary: 'Proxy to Anthropic', description: 'Proxy request to Anthropic Messages API with automatic metering' })
  @ApiResponse({ status: 200, description: 'Anthropic response (may be SSE stream)' })
  async anthropic(@Body() body: unknown, @Req() req: any) {
    const isStreaming = (body as Record<string, unknown>)?.stream === true
    const result = await this.proxyService.proxy(
      req.customer.id,
      'ANTHROPIC',
      body,
      isStreaming,
      undefined,
      req.body?.metadata,
    )

    if (isStreaming) {
      return this.streamResponse(result)
    }
    return JSON.parse(result.body)
  }

  @Post('openai/chat/completions')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('api-key')
  @ApiOperation({ summary: 'Proxy to OpenAI', description: 'Proxy request to OpenAI Chat Completions API with automatic metering' })
  @ApiResponse({ status: 200, description: 'OpenAI response (may be SSE stream)' })
  async openai(@Body() body: unknown, @Req() req: any) {
    const isStreaming = (body as Record<string, unknown>)?.stream === true
    const result = await this.proxyService.proxy(
      req.customer.id,
      'OPENAI',
      body,
      isStreaming,
      undefined,
      req.body?.metadata,
    )

    if (isStreaming) {
      return this.streamResponse(result)
    }
    return JSON.parse(result.body)
  }

  @Post('chat')
  @UseGuards(ApiKeyGuard)
  @HttpCode(HttpStatus.OK)
  @ApiSecurity('api-key')
  @ApiOperation({ summary: 'Auto-detect proxy', description: 'Auto-detect provider from model name and proxy with metering' })
  @ApiResponse({ status: 200, description: 'Provider response' })
  async chat(@Body() body: unknown, @Req() req: any) {
    const b = body as Record<string, unknown>
    const isStreaming = b?.stream === true
    const provider = (b?.provider as string) ?? ''

    const result = await this.proxyService.proxy(
      req.customer.id,
      provider,
      body,
      isStreaming,
      undefined,
      b?.metadata as Record<string, unknown>,
    )

    if (isStreaming) {
      return this.streamResponse(result)
    }
    return JSON.parse(result.body)
  }

  private streamResponse(result: any) {
    return result.body
  }
}
