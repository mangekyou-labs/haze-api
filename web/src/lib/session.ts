import { cache } from 'react';
import { auth } from '@/auth';

/** Pages and their header share session lookup within this render only. */
export const renderSession = cache(async () => auth());
