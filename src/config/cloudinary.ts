import { v2 as cloudinary } from 'cloudinary';
import { env } from './env';

cloudinary.config({
  cloud_name: env.CLOUDINARY_CLOUD_NAME,
  api_key: env.CLOUDINARY_API_KEY,
  api_secret: env.CLOUDINARY_API_SECRET,
  secure: true,
});

export const isCloudinaryConfigured = (): boolean => {
  return Boolean(
    env.CLOUDINARY_CLOUD_NAME &&
    env.CLOUDINARY_CLOUD_NAME.trim() !== '' &&
    env.CLOUDINARY_API_KEY &&
    env.CLOUDINARY_API_KEY.trim() !== '' &&
    env.CLOUDINARY_API_SECRET &&
    env.CLOUDINARY_API_SECRET.trim() !== '',
  );
};

export { cloudinary };
