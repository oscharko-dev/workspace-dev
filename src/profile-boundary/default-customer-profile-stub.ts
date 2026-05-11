const createUnsupportedCustomerProfileError = (): Error =>
  new Error("Customer profile APIs are not available in the default build profile.");

export const safeParseCustomerProfileConfig = (): never => {
  throw createUnsupportedCustomerProfileError();
};

export const toCustomerProfileConfigSnapshot = (): never => {
  throw createUnsupportedCustomerProfileError();
};

export const collectCustomerProfileImportIssuesFromSource = (): never => {
  throw createUnsupportedCustomerProfileError();
};

export const isCustomerProfileMuiFallbackAllowed = (): never => {
  throw createUnsupportedCustomerProfileError();
};

export const isCustomerProfileIconFallbackAllowed = (): never => {
  throw createUnsupportedCustomerProfileError();
};

export const resolveCustomerProfileBrandMapping = (): never => {
  throw createUnsupportedCustomerProfileError();
};

export const resolveCustomerProfileComponentImport = (): never => {
  throw createUnsupportedCustomerProfileError();
};

export const resolveCustomerProfileDatePickerProvider = (): never => {
  throw createUnsupportedCustomerProfileError();
};

export const resolveCustomerProfileFamily = (): never => {
  throw createUnsupportedCustomerProfileError();
};

export const resolveCustomerProfileIconFallbackWrapper = (): never => {
  throw createUnsupportedCustomerProfileError();
};

export const resolveCustomerProfileIconImport = (): never => {
  throw createUnsupportedCustomerProfileError();
};

export const toCustomerProfileDesignSystemConfig = (): never => {
  throw createUnsupportedCustomerProfileError();
};

export const toCustomerProfileDesignSystemConfigFromComponentMatchReport =
  (): never => {
    throw createUnsupportedCustomerProfileError();
  };
