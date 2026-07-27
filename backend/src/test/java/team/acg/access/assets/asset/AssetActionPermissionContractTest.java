package team.acg.access.assets.asset;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

class AssetActionPermissionContractTest {
    @Test
    void mapsLifecycleActionsToTheirBusinessPermissionDomains() {
        assertThat(AssetActionPermissionContract.requiredPermissions("receive"))
            .containsExactlyInAnyOrder("asset:receive_return:receive", "asset:item:receive");
        assertThat(AssetActionPermissionContract.requiredPermissions("return"))
            .containsExactlyInAnyOrder("asset:receive_return:return", "asset:item:return");
        assertThat(AssetActionPermissionContract.requiredPermissions("handover"))
            .containsExactlyInAnyOrder("asset:receive_return:handover", "asset:item:handover");
        assertThat(AssetActionPermissionContract.requiredPermissions("borrow"))
            .containsExactlyInAnyOrder("asset:borrow_return:borrow", "asset:item:borrow");
        assertThat(AssetActionPermissionContract.requiredPermissions("borrow-return"))
            .containsExactlyInAnyOrder("asset:borrow_return:return", "asset:item:borrowReturn");
        assertThat(AssetActionPermissionContract.requiredPermissions("cancel-inbound"))
            .containsExactly("asset:inbound:cancel");
        assertThat(AssetActionPermissionContract.requiredPermissions("update-import"))
            .containsExactly("asset:item:updateImport");
        assertThat(AssetActionPermissionContract.requiredPermissions("receive-import"))
            .containsExactly("asset:item:receiveImport");
    }

    @Test
    void rejectsActionsThatHaveNoDeclaredPermissionContract() {
        assertThatThrownBy(() -> AssetActionPermissionContract.requiredPermissions("unsafe"))
            .isInstanceOf(IllegalArgumentException.class);
    }
}
