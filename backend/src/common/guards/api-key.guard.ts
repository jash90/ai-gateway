import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as crypto from 'crypto';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const apiKey = this.extractApiKey(request);
    if (!apiKey) {
      throw new UnauthorizedException({ code: 'MISSING_API_KEY', message: 'Missing API key' });
    }

    const hash = this.hashKey(apiKey);
    const customer = await this.prisma.customer.findFirst({
      where: { apiKeyHash: hash, isActive: true },
    });

    if (!customer) {
      throw new UnauthorizedException({ code: 'INVALID_API_KEY', message: 'Invalid API key' });
    }

    request.customer = { id: customer.id, name: customer.name, tier: customer.tier };
    return true;
  }

  private extractApiKey(request: any): string | null {
    // Check Authorization: Bearer om_live_xxx
    const auth = request.headers?.authorization;
    if (auth?.startsWith('Bearer ')) {
      return auth.slice(7);
    }
    // Check X-API-Key header
    return request.headers?.['x-api-key'] ?? null;
  }

  private hashKey(key: string): string {
    return crypto.createHash('sha256').update(key).digest('hex');
  }
}
