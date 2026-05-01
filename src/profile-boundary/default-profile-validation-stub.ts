const createUnsupportedProfileValidationError = (): Error =>
  new Error("Customer profile validation is not available in the default build profile.");

export const validateCustomerProfileComponentApiComponentMatchReport =
  (): never => {
    throw createUnsupportedProfileValidationError();
  };

export const validateCustomerProfileComponentMatchReport = (): never => {
  throw createUnsupportedProfileValidationError();
};

export const validateGeneratedProjectCustomerProfile = (): never => {
  throw createUnsupportedProfileValidationError();
};

export const validateGeneratedProjectStorybookStyles = (): never => {
  throw createUnsupportedProfileValidationError();
};
