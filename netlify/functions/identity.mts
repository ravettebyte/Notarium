// Accounts are created only through the controlled server API, using Identity admin operations.
export default { userValidate(event:any) { return event.deny(); } };
