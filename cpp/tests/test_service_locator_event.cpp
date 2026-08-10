/// @file test_service_locator_event.cpp
/// Tests pour ServiceLocator (style Overload) et template Event<Args...>.

#include "iecode/engine/core/event.h"
#include "iecode/engine/core/service_locator.h"

#include <gtest/gtest.h>

#include <string>

namespace {

struct DummyService {
    int value = 42;
};

struct OtherService {
    std::string name = "iecode";
};

} // namespace

// ── ServiceLocator ──────────────────────────────────────────────────

TEST(ServiceLocatorTest, ProvideAndGetOverloadStyle) {
    lives::ServiceLocator::clear();
    DummyService svc;
    lives::ServiceLocator::Provide(svc);

    auto& got = lives::ServiceLocator::Get<DummyService>();
    EXPECT_EQ(&got, &svc);
    EXPECT_EQ(got.value, 42);
}

TEST(ServiceLocatorTest, ProvideAndGetSnakeCase) {
    lives::ServiceLocator::clear();
    DummyService svc;
    lives::ServiceLocator::provide(&svc);

    EXPECT_TRUE(lives::ServiceLocator::has<DummyService>());
    EXPECT_EQ(&lives::ServiceLocator::get<DummyService>(), &svc);
}

TEST(ServiceLocatorTest, MacroAccess) {
    lives::ServiceLocator::clear();
    DummyService svc;
    svc.value = 1234;
    lives::ServiceLocator::Provide(svc);

    EXPECT_EQ(IECODE_SERVICE(DummyService).value, 1234);
}

TEST(ServiceLocatorTest, MultipleServices) {
    lives::ServiceLocator::clear();
    DummyService a;
    OtherService b;
    lives::ServiceLocator::Provide(a);
    lives::ServiceLocator::Provide(b);

    EXPECT_EQ(&lives::ServiceLocator::Get<DummyService>(), &a);
    EXPECT_EQ(lives::ServiceLocator::Get<OtherService>().name, "iecode");
}

TEST(ServiceLocatorTest, TryGetReturnsNullWhenAbsent) {
    lives::ServiceLocator::clear();
    EXPECT_EQ(lives::ServiceLocator::try_get<DummyService>(), nullptr);
}

TEST(ServiceLocatorTest, RemoveService) {
    lives::ServiceLocator::clear();
    DummyService svc;
    lives::ServiceLocator::Provide(svc);
    EXPECT_TRUE(lives::ServiceLocator::has<DummyService>());

    lives::ServiceLocator::remove<DummyService>();
    EXPECT_FALSE(lives::ServiceLocator::has<DummyService>());
}

// ── Event<Args...> ──────────────────────────────────────────────────

TEST(EventTemplateTest, AddListenerAndInvoke) {
    lives::Event<int> on_value;
    int captured = 0;
    auto id = on_value.add_listener([&](int v) { captured = v; });
    EXPECT_NE(id, 0u);

    on_value.invoke(123);
    EXPECT_EQ(captured, 123);
}

TEST(EventTemplateTest, MultipleArgs) {
    lives::Event<int, int, std::string> evt;
    int sum = 0;
    std::string last;
    (void)evt.add_listener([&](int a, int b, std::string s) {
        sum = a + b;
        last = std::move(s);
    });

    evt.invoke(2, 3, "ok");
    EXPECT_EQ(sum, 5);
    EXPECT_EQ(last, "ok");
}

TEST(EventTemplateTest, RemoveListener) {
    lives::Event<> evt;
    int count = 0;
    auto id = evt.add_listener([&] { ++count; });
    evt.invoke();
    EXPECT_EQ(count, 1);

    EXPECT_TRUE(evt.remove_listener(id));
    evt.invoke();
    EXPECT_EQ(count, 1);
    EXPECT_FALSE(evt.remove_listener(id));
}

TEST(EventTemplateTest, OperatorOverloads) {
    lives::Event<int> evt;
    int total = 0;
    evt += [&](int v) { total += v; };
    evt += [&](int v) { total += v * 2; };

    evt.invoke(10);
    EXPECT_EQ(total, 30);
    EXPECT_EQ(evt.listener_count(), 2u);
}

TEST(EventTemplateTest, RemoveAllListeners) {
    lives::Event<> evt;
    (void)evt.add_listener([] {});
    (void)evt.add_listener([] {});
    EXPECT_EQ(evt.listener_count(), 2u);

    evt.remove_all_listeners();
    EXPECT_EQ(evt.listener_count(), 0u);
}

TEST(EventTemplateTest, InvokeWithNoListeners) {
    lives::Event<int> evt;
    EXPECT_NO_THROW(evt.invoke(0));
}

TEST(EventTemplateTest, ListenerCanRemoveItselfDuringInvoke) {
    // Verifie que la copie defensive evite l'invalidation d'iterateur.
    lives::Event<> evt;
    lives::ListenerID self_id = 0;
    int calls = 0;
    self_id = evt.add_listener([&] {
        ++calls;
        evt.remove_listener(self_id);
    });

    evt.invoke();
    evt.invoke();
    EXPECT_EQ(calls, 1);
}

// ── ThreadSafeEvent ─────────────────────────────────────────────────

TEST(ThreadSafeEventTest, BasicInvoke) {
    lives::ThreadSafeEvent<int> evt;
    int captured = 0;
    (void)evt.add_listener([&](int v) { captured = v; });
    evt.invoke(7);
    EXPECT_EQ(captured, 7);
}
