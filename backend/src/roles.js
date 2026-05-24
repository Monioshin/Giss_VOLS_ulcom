function userRole(req) {
  return req.authUser?.role ?? "USER";
}

function canEditRole(role) {
  return role === "ADMIN" || role === "ARCHITECT";
}

function requireEditor(req, res, next) {
  if (!canEditRole(userRole(req))) {
    return res.status(403).json({ message: "Недостаточно прав для изменения данных" });
  }
  return next();
}

function requireAdmin(req, res, next) {
  if (userRole(req) !== "ADMIN") {
    return res.status(403).json({ message: "Только администратор" });
  }
  return next();
}

module.exports = { requireEditor, requireAdmin, canEditRole, userRole };
