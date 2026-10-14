import { describe, expect, it } from 'vitest';
import { isSafeAwsUrl, pageContext } from '@/app/runtime';
import { useCity } from '@/state/store';

describe('what leaves the browser', () => {
  it('only AWS console and docs pages are shared with the agents', () => {
    useCity.getState().setFocus({ url: 'https://mail.example.com/inbox/123', title: 'Re: my bank statement', kind: 'other' });
    expect(pageContext()).toEqual({});
    useCity.getState().setFocus({ url: 'https://us-west-2.console.aws.amazon.com/s3/home', title: 'S3', kind: 'console', serviceId: 's3' });
    expect(pageContext()).toEqual({ url: 'https://us-west-2.console.aws.amazon.com/s3/home', title: 'S3', serviceId: 's3' });
  });

  it('links from the server open only when they are AWS console pages over https', () => {
    expect(isSafeAwsUrl('https://us-west-2.console.aws.amazon.com/cloudformation/home#/stacks/quickcreate')).toBe(true);
    expect(isSafeAwsUrl('https://console.aws.amazon.com/')).toBe(true);
    expect(isSafeAwsUrl('http://us-west-2.console.aws.amazon.com/')).toBe(false);
    expect(isSafeAwsUrl('https://console.aws.amazon.com.evil.example/')).toBe(false);
    expect(isSafeAwsUrl('https://user@console.aws.amazon.com/')).toBe(false);
    expect(isSafeAwsUrl('javascript:alert(1)')).toBe(false);
  });
});
