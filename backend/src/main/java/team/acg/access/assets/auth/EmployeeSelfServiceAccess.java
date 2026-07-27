package team.acg.access.assets.auth;

import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.Set;

final class EmployeeSelfServiceAccess {
    static final Set<String> PERMISSIONS = Set.of(
        "asset:item:view",
        "asset:receive_return:view",
        "asset:receive_return:sign",
        "asset:request:view",
        "asset:request:create",
        "asset:self_service:view"
    );

    private EmployeeSelfServiceAccess() {}

    static Set<String> merge(Collection<String> grantedPermissions) {
        LinkedHashSet<String> merged = new LinkedHashSet<>();
        if (grantedPermissions != null) {
            grantedPermissions.stream().filter(java.util.Objects::nonNull).forEach(merged::add);
        }
        merged.addAll(PERMISSIONS);
        return Set.copyOf(merged);
    }
}
