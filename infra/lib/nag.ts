import { type IConstruct } from 'constructs';
import { Token, Validations } from 'aws-cdk-lib';

/** cdk-nag v3: acknowledge a finding on a construct (and its children), with the reason recorded. */
export const ack = (scope: IConstruct, rules: { id: string; reason: string }[]) => Validations.of(scope).acknowledge(...rules);

/** How cdk-nag prints an account in finding ids: the literal id, or <AWS::AccountId> when env-agnostic. */
export const nagAccount = (account: string) => (Token.isUnresolved(account) ? '<AWS::AccountId>' : account);
