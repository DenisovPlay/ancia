export function clearFieldValidation(field) {
  if (!field) {
    return;
  }
  field.classList.remove("field-invalid");
  field.removeAttribute("aria-invalid");
}

export function isValidTimezone(timezone) {
  const normalized = String(timezone || "").trim();
  if (!normalized) {
    return false;
  }
  try {
    new Intl.DateTimeFormat("ru-RU", { timeZone: normalized });
    return true;
  } catch (error) {
    return false;
  }
}
