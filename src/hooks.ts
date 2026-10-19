import { useQuery } from '@tanstack/react-query'
import { channelsApi, messagesApi, profilesApi, promotionApi } from './api'

export const useChannels = () => useQuery({ queryKey: ['channels'], queryFn: channelsApi.list })
export const useMessages = () => useQuery({ queryKey: ['messages'], queryFn: messagesApi.list })
export const useProfiles = () => useQuery({ queryKey: ['profiles'], queryFn: profilesApi.list })
export const useLogs = () => useQuery({ queryKey: ['logs'], queryFn: promotionApi.logs, refetchInterval: 15_000 })
