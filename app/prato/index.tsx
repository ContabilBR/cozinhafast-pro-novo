import React, { useEffect, useState, useCallback } from 'react';
import {
  View, Text, FlatList, TextInput, TouchableOpacity,
  Modal, Alert, ActivityIndicator, KeyboardAvoidingView,
  Platform, Image, ScrollView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';
import { AnimatedPressable } from '@/components/AnimatedPressable';
import { apiGet, apiPost, apiPut, apiDelete } from '@/utils/api';
import { CampoMoeda } from '@/components/CampoMoeda';

interface Categoria { id: string; nome: string; }
interface Prato {
  id: string;
  nome: string;
  descricao?: string;
  preco: number;
  categoriaId?: string;
  categoria?: Categoria;
  imagemUrl?: string;
  disponivel?: boolean;
}

export default function GerenciarPratosScreen() {
  const COLORS = useColors();
  const router = useRouter();

  const [pratos, setPratos] = useState<Prato[]>([]);
  const [categorias, setCategorias] = useState<Categoria[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [modalNome, setModalNome] = useState('');
  const [modalDescricao, setModalDescricao] = useState('');
  const [modalPreco, setModalPreco] = useState('');
  const [modalCategoriaId, setModalCategoriaId] = useState<string | null>(null);
  const [modalImagemUrl, setModalImagemUrl] = useState('');
  const [modalDisponivel, setModalDisponivel] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [pratosRes, categoriasRes] = await Promise.all([
        apiGet<any>('/api/pratos'),
        apiGet<any>('/api/categorias'),
      ]);
      const pratosList: Prato[] = Array.isArray(pratosRes) ? pratosRes : (pratosRes?.pratos ?? []);
      const categoriasList: Categoria[] = Array.isArray(categoriasRes) ? categoriasRes : (categoriasRes?.categorias ?? []);
      setPratos(pratosList);
      setCategorias(categoriasList);
    } catch (e) {
      console.error('[Pratos] Erro ao carregar:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleBack = () => {
    console.log('[Pratos] Botão Voltar pressionado');
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/(home)' as any);
  };

  const openCreate = () => {
    console.log('[Pratos] Botão Incluir pressionado');
    setEditingId(null);
    setModalNome('');
    setModalDescricao('');
    setModalPreco('');
    setModalCategoriaId(null);
    setModalImagemUrl('');
    setModalDisponivel(true);
    setShowModal(true);
  };

  const openEdit = (prato: Prato) => {
    console.log('[Pratos] Botão Editar pressionado, id:', prato.id, 'nome:', prato.nome);
    setEditingId(prato.id);
    setModalNome(prato.nome);
    setModalDescricao(prato.descricao ?? '');
    setModalPreco(String(prato.preco));
    setModalCategoriaId(prato.categoriaId ?? prato.categoria?.id ?? null);
    setModalImagemUrl(prato.imagemUrl ?? '');
    setModalDisponivel(prato.disponivel !== false);
    setShowModal(true);
  };

  const handleSave = async () => {
    console.log('[Pratos] Botão Salvar pressionado, editingId:', editingId);
    if (!modalNome.trim()) { Alert.alert('Atenção', 'Nome é obrigatório.'); return; }
    const preco = parseFloat(modalPreco.replace(',', '.'));
    if (isNaN(preco) || preco < 0) { Alert.alert('Atenção', 'Preço inválido.'); return; }
    setSaving(true);
    const body = {
      nome: modalNome.trim(),
      descricao: modalDescricao.trim() || null,
      preco,
      categoriaId: modalCategoriaId || null,
      imagemUrl: modalImagemUrl.trim() || null,
      disponivel: modalDisponivel,
    };
    try {
      if (editingId) {
        console.log('[Pratos] PUT /api/pratos/' + editingId, body);
        await apiPut(`/api/pratos/${editingId}`, body);
      } else {
        console.log('[Pratos] POST /api/pratos', body);
        await apiPost('/api/pratos', body);
      }
      setShowModal(false);
      fetchData();
      setShowSaveSuccess(true);
      setTimeout(() => setShowSaveSuccess(false), 2000);
    } catch (e: any) {
      console.error('[Pratos] Erro ao salvar:', e);
      Alert.alert('Erro', e?.message ?? 'Não foi possível salvar o prato.');
    } finally {
      setSaving(false);
    }
  };

  const confirmDelete = (id: string, nome: string) => {
    console.log('[Pratos] Botão Excluir pressionado, id:', id, 'nome:', nome);
    Alert.alert(
      'Excluir prato',
      `Deseja excluir o prato "${nome}"?\n\nEsta ação não pode ser desfeita.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Excluir', style: 'destructive', onPress: () => doDelete([id]) },
      ]
    );
  };

  const confirmBulkDelete = () => {
    console.log('[Pratos] Botão Excluir em lote pressionado, quantidade:', selected.size);
    if (selected.size === 0) return;
    Alert.alert(
      'Excluir pratos',
      `Deseja excluir ${selected.size} prato(s) selecionado(s)?\n\nEsta ação não pode ser desfeita.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        { text: `Excluir ${selected.size}`, style: 'destructive', onPress: () => doDelete(Array.from(selected)) },
      ]
    );
  };

  const doDelete = async (ids: string[]) => {
    setDeleting(true);
    const errors: string[] = [];
    for (const id of ids) {
      try {
        console.log('[Pratos] DELETE /api/pratos/' + id);
        await apiDelete(`/api/pratos/${id}`);
      } catch (e: any) {
        console.error('[Pratos] Erro ao excluir id:', id, e);
        errors.push(e?.message || 'Erro ao excluir.');
      }
    }
    setSelected(new Set());
    setSelectMode(false);
    setDeleting(false);
    await fetchData();
    if (errors.length > 0) Alert.alert('Atenção', errors[0]);
  };

  const toggleSelect = (id: string) => {
    console.log('[Pratos] Toggle seleção, id:', id);
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const enterSelectMode = (id: string) => {
    console.log('[Pratos] Entrar em modo seleção, id:', id);
    setSelectMode(true);
    setSelected(new Set([id]));
  };

  const exitSelectMode = () => {
    console.log('[Pratos] Sair do modo seleção');
    setSelectMode(false);
    setSelected(new Set());
  };

  const formatPreco = (preco: number) => {
    const num = Number(preco);
    return isNaN(num) ? 'R$ 0,00' : `R$ ${num.toFixed(2).replace('.', ',')}`;
  };

  const inputStyle = {
    backgroundColor: COLORS.surfaceSecondary,
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: COLORS.text,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 12,
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: COLORS.background }} edges={['top', 'left', 'right']}>
      {/* Nav bar */}
      <View style={{
        flexDirection: 'row', alignItems: 'center', height: 56,
        paddingHorizontal: 16, borderBottomWidth: 1,
        borderBottomColor: COLORS.border, backgroundColor: COLORS.surface,
      }}>
        {selectMode ? (
          <TouchableOpacity onPress={exitSelectMode} style={{ paddingVertical: 8, paddingRight: 12 }}>
            <Text style={{ color: '#007AFF', fontSize: 16, fontWeight: '500' }}>Cancelar</Text>
          </TouchableOpacity>
        ) : (
          <AnimatedPressable
            onPress={handleBack}
            style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8, paddingRight: 8 }}
          >
            <Ionicons name="chevron-back" size={26} color="#007AFF" />
            <Text style={{ color: '#007AFF', fontSize: 17, fontWeight: '500' }}>Voltar</Text>
          </AnimatedPressable>
        )}
        <Text style={{
          position: 'absolute', left: 0, right: 0, textAlign: 'center',
          fontSize: 17, fontWeight: '700', color: COLORS.text, height: 56, lineHeight: 56,
        }}>Pratos</Text>
        <View style={{ marginLeft: 'auto', flexDirection: 'row', gap: 8 }}>
          {selectMode ? (
            <TouchableOpacity
              onPress={confirmBulkDelete}
              disabled={selected.size === 0 || deleting}
              style={{
                backgroundColor: selected.size > 0 ? '#FF3B30' : COLORS.border,
                borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6,
                flexDirection: 'row', alignItems: 'center', gap: 4,
              }}
            >
              {deleting
                ? <ActivityIndicator size="small" color="#fff" />
                : <Ionicons name="trash" size={14} color="#fff" />}
              <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>
                Excluir ({selected.size})
              </Text>
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity
                onPress={() => { console.log('[Pratos] Botão Selecionar pressionado'); setSelectMode(true); }}
                style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}
              >
                <Text style={{ color: COLORS.textSecondary, fontSize: 14, fontWeight: '500' }}>Selecionar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={openCreate}
                style={{ backgroundColor: COLORS.primary, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 4 }}
              >
                <Ionicons name="add" size={16} color="#fff" />
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>Incluir</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={COLORS.primary} size="large" />
        </View>
      ) : (
        <FlatList
          data={pratos}
          keyExtractor={item => item.id}
          contentContainerStyle={{ padding: 16, paddingBottom: 120, gap: 10 }}
          renderItem={({ item }) => {
            const isSelected = selected.has(item.id);
            const precoFormatado = formatPreco(item.preco);
            const categoriaNome = item.categoria?.nome ?? categorias.find(c => c.id === item.categoriaId)?.nome ?? null;
            return (
              <TouchableOpacity
                onPress={() => { if (selectMode) toggleSelect(item.id); }}
                onLongPress={() => { if (!selectMode) enterSelectMode(item.id); }}
                activeOpacity={selectMode ? 0.6 : 1}
                style={{
                  flexDirection: 'row', alignItems: 'center',
                  backgroundColor: isSelected ? COLORS.primaryMuted : COLORS.surface,
                  borderRadius: 12, padding: 12, borderWidth: 1,
                  borderColor: isSelected ? COLORS.primary : COLORS.border, gap: 12,
                }}
              >
                {selectMode && (
                  <View style={{
                    width: 24, height: 24, borderRadius: 12, borderWidth: 2,
                    borderColor: isSelected ? COLORS.primary : COLORS.border,
                    backgroundColor: isSelected ? COLORS.primary : 'transparent',
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    {isSelected && <Ionicons name="checkmark" size={14} color="#fff" />}
                  </View>
                )}
                {item.imagemUrl ? (
                  <Image
                    source={{ uri: item.imagemUrl }}
                    style={{ width: 56, height: 56, borderRadius: 10, backgroundColor: COLORS.border }}
                    resizeMode="cover"
                  />
                ) : (
                  <View style={{
                    width: 56, height: 56, borderRadius: 10,
                    backgroundColor: COLORS.surfaceSecondary,
                    alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Ionicons name="restaurant-outline" size={24} color={COLORS.textTertiary} />
                  </View>
                )}
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: '600', color: COLORS.text }}>{item.nome}</Text>
                  {item.descricao ? (
                    <Text style={{ fontSize: 12, color: COLORS.textSecondary, marginTop: 2 }} numberOfLines={1}>
                      {item.descricao}
                    </Text>
                  ) : null}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                    <Text style={{ fontSize: 14, fontWeight: '700', color: COLORS.primary }}>{precoFormatado}</Text>
                    {categoriaNome ? (
                      <View style={{ backgroundColor: COLORS.surfaceSecondary, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={{ fontSize: 11, color: COLORS.textSecondary }}>{categoriaNome}</Text>
                      </View>
                    ) : null}
                    {item.disponivel === false ? (
                      <View style={{ backgroundColor: '#FF3B3020', borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 }}>
                        <Text style={{ fontSize: 11, color: '#FF3B30' }}>Indisponível</Text>
                      </View>
                    ) : null}
                  </View>
                </View>
                {!selectMode && (
                  <View style={{ flexDirection: 'row', gap: 8 }}>
                    <TouchableOpacity
                      onPress={() => openEdit(item)}
                      style={{ backgroundColor: '#007AFF', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 4 }}
                    >
                      <Ionicons name="pencil" size={13} color="#fff" />
                      <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>Editar</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={() => confirmDelete(item.id, item.nome)}
                      style={{ backgroundColor: '#FF3B30', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6, flexDirection: 'row', alignItems: 'center', gap: 4 }}
                    >
                      <Ionicons name="trash" size={13} color="#fff" />
                      <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>Excluir</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </TouchableOpacity>
            );
          }}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 60, gap: 8 }}>
              <Ionicons name="restaurant-outline" size={48} color={COLORS.textTertiary} />
              <Text style={{ fontSize: 16, color: COLORS.textSecondary }}>Nenhum prato cadastrado</Text>
            </View>
          }
        />
      )}

      {/* Create/Edit Modal — bottom sheet */}
      <Modal visible={showModal} transparent animationType="slide" onRequestClose={() => setShowModal(false)}>
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          {/* Backdrop */}
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' }}
            activeOpacity={1}
            onPress={() => setShowModal(false)}
          />
          {/* Sheet — plain View, NOT TouchableOpacity */}
          <View
            style={{
              maxHeight: '90%',
              backgroundColor: COLORS.surface,
              borderTopLeftRadius: 20,
              borderTopRightRadius: 20,
            }}
          >
            {/* Drag handle + title */}
            <View style={{ paddingHorizontal: 24, paddingTop: 16, paddingBottom: 8 }}>
              <View style={{ alignItems: 'center', marginBottom: 12 }}>
                <View style={{ width: 40, height: 4, borderRadius: 2, backgroundColor: COLORS.border }} />
              </View>
              <Text style={{ fontSize: 18, fontWeight: '700', color: COLORS.text }}>
                {editingId ? 'Editar Prato' : 'Novo Prato'}
              </Text>
            </View>

            {/* Scrollable form */}
            <ScrollView
              style={{ flexGrow: 1 }}
              contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 8 }}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator={false}
            >
              <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.text, marginBottom: 6 }}>Nome *</Text>
              <TextInput
                value={modalNome} onChangeText={setModalNome}
                placeholder="Nome do prato" placeholderTextColor={COLORS.textTertiary}
                style={inputStyle} autoFocus autoCapitalize="sentences"
              />

              <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.text, marginBottom: 6 }}>Descrição</Text>
              <TextInput
                value={modalDescricao} onChangeText={setModalDescricao}
                placeholder="Descrição (opcional)" placeholderTextColor={COLORS.textTertiary}
                style={[inputStyle, { minHeight: 72, textAlignVertical: 'top' }]}
                multiline autoCapitalize="sentences"
              />

              <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.text, marginBottom: 6 }}>Preço (R$) *</Text>
              <CampoMoeda
                value={modalPreco} onChangeText={setModalPreco}
                placeholder="0,00" placeholderTextColor={COLORS.textTertiary}
                style={inputStyle}
              />

              <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.text, marginBottom: 6 }}>Categoria</Text>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 12 }}>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TouchableOpacity
                    onPress={() => { console.log('[Pratos] Categoria selecionada: Nenhuma'); setModalCategoriaId(null); }}
                    style={{
                      paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
                      backgroundColor: modalCategoriaId === null ? COLORS.primary : COLORS.surfaceSecondary,
                      borderWidth: 1, borderColor: modalCategoriaId === null ? COLORS.primary : COLORS.border,
                    }}
                  >
                    <Text style={{ color: modalCategoriaId === null ? '#fff' : COLORS.textSecondary, fontSize: 13, fontWeight: '600' }}>Nenhuma</Text>
                  </TouchableOpacity>
                  {categorias.map(cat => (
                    <TouchableOpacity
                      key={cat.id}
                      onPress={() => { console.log('[Pratos] Categoria selecionada:', cat.nome, 'id:', cat.id); setModalCategoriaId(cat.id); }}
                      style={{
                        paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
                        backgroundColor: modalCategoriaId === cat.id ? COLORS.primary : COLORS.surfaceSecondary,
                        borderWidth: 1, borderColor: modalCategoriaId === cat.id ? COLORS.primary : COLORS.border,
                      }}
                    >
                      <Text style={{ color: modalCategoriaId === cat.id ? '#fff' : COLORS.textSecondary, fontSize: 13, fontWeight: '600' }}>{cat.nome}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </ScrollView>

              <Text style={{ fontSize: 14, fontWeight: '600', color: COLORS.text, marginBottom: 6 }}>URL da Imagem</Text>
              <TextInput
                value={modalImagemUrl} onChangeText={setModalImagemUrl}
                placeholder="https://..." placeholderTextColor={COLORS.textTertiary}
                style={inputStyle} keyboardType="url" autoCapitalize="none"
              />

              <TouchableOpacity
                onPress={() => { console.log('[Pratos] Toggle disponível:', !modalDisponivel); setModalDisponivel(v => !v); }}
                style={{
                  flexDirection: 'row', alignItems: 'center', gap: 10,
                  backgroundColor: COLORS.surfaceSecondary, borderRadius: 10,
                  padding: 14, marginBottom: 8, borderWidth: 1, borderColor: COLORS.border,
                }}
              >
                <View style={{
                  width: 22, height: 22, borderRadius: 6, borderWidth: 2,
                  borderColor: modalDisponivel ? COLORS.primary : COLORS.border,
                  backgroundColor: modalDisponivel ? COLORS.primary : 'transparent',
                  alignItems: 'center', justifyContent: 'center',
                }}>
                  {modalDisponivel && <Ionicons name="checkmark" size={13} color="#fff" />}
                </View>
                <Text style={{ fontSize: 15, color: COLORS.text, fontWeight: '500' }}>Disponível</Text>
              </TouchableOpacity>
            </ScrollView>

            {/* Fixed action buttons — always visible, outside ScrollView */}
            <View style={{
              paddingHorizontal: 24,
              paddingTop: 12,
              paddingBottom: 32,
              borderTopWidth: 1,
              borderTopColor: COLORS.border,
              backgroundColor: COLORS.surface,
            }}>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <TouchableOpacity
                  onPress={() => { console.log('[Pratos] Botão Cancelar modal pressionado'); setShowModal(false); }}
                  style={{ flex: 1, height: 48, borderRadius: 12, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Text style={{ color: COLORS.textSecondary, fontWeight: '600' }}>Cancelar</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={handleSave}
                  disabled={saving}
                  style={{ flex: 1, height: 48, borderRadius: 12, backgroundColor: COLORS.primary, alignItems: 'center', justifyContent: 'center', opacity: saving ? 0.7 : 1 }}
                >
                  {saving ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Salvar</Text>}
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Success Toast */}
      <Modal visible={showSaveSuccess} transparent animationType="fade">
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.35)' }}>
          <View style={{
            backgroundColor: COLORS.surface, borderRadius: 20,
            paddingVertical: 32, paddingHorizontal: 40,
            alignItems: 'center', gap: 8,
            shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 20, elevation: 10,
          }}>
            <Text style={{ fontSize: 48 }}>✅</Text>
            <Text style={{ fontSize: 18, fontWeight: '700', color: COLORS.text, marginTop: 4 }}>Prato salvo!</Text>
            <Text style={{ fontSize: 14, color: COLORS.textSecondary, textAlign: 'center' }}>
              O prato foi cadastrado com sucesso.
            </Text>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
