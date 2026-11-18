import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { EnvironmentConfig } from './config/environment.config';
import { validationPipeOptions } from './config/validation.config';
import { corsDelegate } from './config/cors.config';

// Validate environment variables at startup
EnvironmentConfig.validate();

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: EnvironmentConfig.IS_TEST 
      ? false 
      : EnvironmentConfig.NODE_ENV === 'development' 
        ? ['error', 'warn', 'log', 'debug', 'verbose']
        : ['error', 'warn', 'log'],
  });

  // Security: Add comprehensive security headers
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "https:"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        objectSrc: ["'none'"],
        mediaSrc: ["'self'"],
        frameSrc: ["'none'"],
      },
    },
    hsts: {
      maxAge: 31536000, // 1 year
      includeSubDomains: true,
      preload: true,
    },
    noSniff: true,
    xssFilter: true,
    referrerPolicy: { policy: "strict-origin-when-cross-origin" },
    hidePoweredBy: true,
  }));

  // Security: Global validation pipe for input validation
  app.useGlobalPipes(new ValidationPipe(validationPipeOptions()));

  // Stop cleanly on SIGTERM (redeploys): finish in-flight requests, then close
  // the Discord connection.
  app.enableShutdownHooks();

  app.setGlobalPrefix('api');
  
  // Security: Restrict CORS to known origins
  const allowedOrigins = [
    EnvironmentConfig.BASE_URL,
    ...(EnvironmentConfig.NODE_ENV === 'development' ? [
      'http://localhost:4200', // Development frontend
      'http://localhost:3000', // Alternative dev port
    ] : [])
  ].filter(Boolean) as string[];
  app.enableCors(corsDelegate(allowedOrigins, origin => {
    if (EnvironmentConfig.NODE_ENV !== 'production') Logger.warn(`CORS blocked origin: ${origin}`, 'Security');
  }));

  // Use Railway's PORT environment variable
  const port = process.env.PORT || 3000;
  await app.listen(port, '0.0.0.0');
  
  // Only log server startup in development
  if (EnvironmentConfig.NODE_ENV === 'development') {
    Logger.log(`Server running on http://localhost:${port}`, 'Bootstrap');
  } else {
    Logger.log(`🚀 Application is running on port ${port}`, 'Bootstrap');
  }
}
bootstrap();
