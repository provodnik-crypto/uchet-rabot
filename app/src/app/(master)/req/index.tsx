import { useEffect, useState } from 'react';
import { AppHeader } from '../../../components/AppHeader';
import { BottomTabs } from '../../../components/BottomTabs';
import { RequestList, type ListFilter } from '../../../components/RequestList';
import { Screen } from '../../../components/Screen';
import { SearchBox } from '../../../components/SearchBox';
import { useAuth } from '../../../lib/auth';
import { markRequestsSeen } from '../../../lib/requests';

/** Вкладка «Заявки»: поиск в жёлтой шапке, фильтры, список. */
export default function MasterRequestsScreen() {
  const { me } = useAuth();
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<ListFilter>('free');
  // Открыли список — «Новые» обнуляются.
  useEffect(() => {
    if (me) markRequestsSeen(me.id);
  }, [me]);
  return (
    <Screen
      tabs
      footer={<BottomTabs />}
      header={
        <AppHeader title="Заявки" large>
          <SearchBox label="Поиск заявки" value={q} onChangeText={setQ} placeholder="Номер или слово из текста" autoCorrect={false} />
        </AppHeader>
      }
    >
      <RequestList q={q} filter={q ? 'all' : filter} onFilter={setFilter} tourId="req.first" />
    </Screen>
  );
}
