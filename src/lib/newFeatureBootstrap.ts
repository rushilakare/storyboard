export const NEW_FEATURE_BOOTSTRAP_KEY = "speqtr_new_feature_bootstrap";

export type NewFeatureBootstrapPayload = {
  workspaceId: string;
  featureId: string;
  name: string;
  purpose: string;
  requirements: string;
};
