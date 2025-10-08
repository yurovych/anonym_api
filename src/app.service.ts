import { Injectable } from '@nestjs/common';

@Injectable()
export class AppService {
  isServerRunning(): string {
    return 'Server is running';
  }
}
