package team.acg.access.assets.asset;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AssetActionPermissionContractTest {
    @Test
    void mapsLifecycleActionsToTheirBusinessPermissionDomains() {
        assertThat(AssetActionPermissionContract.requiredPermission("receive")).isEqualTo("asset:receive_return:receive");
        assertThat(AssetActionPermissionContract.requiredPermission("return")).isEqualTo("asset:receive_return:return");
        assertThat(AssetActionPermissionContract.requiredPermission("handover")).isEqualTo("asset:receive_return:handover");
        assertThat(AssetActionPermissionContract.requiredPermission("borrow")).isEqualTo("asset:borrow_return:borrow");
        assertThat(AssetActionPermissionContract.requiredPermission("borrow-return")).isEqualTo("asset:borrow_return:return");
        assertThat(AssetActionPermissionContract.requiredPermission("cancel-inbound")).isEqualTo("asset:inbound:cancel");
        assertThat(AssetActionPermissionContract.requiredPermission("update-import")).isEqualTo("asset:item:updateImport");
        assertThat(AssetActionPermissionContract.requiredPermission("receive-import")).isEqualTo("asset:item:receiveImport");
    }

    @Test
    void rejectsActionsThatHaveNoDeclaredPermissionContract() {
        assertThatThrownBy(() -> AssetActionPermissionContract.requiredPermission("unsafe"))
            .isInstanceOf(IllegalArgumentException.class);
    }
}
